//! Background CPU/RAM sampler. A single task samples every running instance once
//! per second into a per-instance ring buffer; API handlers and WebSockets only
//! read from it, so measurement cost doesn't grow with the number of viewers.

use chrono::Utc;
use circular_queue::CircularQueue;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tokio::time::{MissedTickBehavior, interval};
use tracing::error;

use crate::instance_manager::InstanceManager;

pub const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);
/// 5 minutes of history at one sample per second.
pub const HISTORY_CAPACITY: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct MetricSample {
    /// Unix timestamp in milliseconds.
    pub t: i64,
    /// Percent of total host CPU (0-100).
    pub cpu: f32,
    pub ram_mb: u64,
    pub uptime_s: u64,
}

struct InstanceHistory {
    pid: u32,
    samples: CircularQueue<MetricSample>,
}

#[derive(Default)]
pub struct MetricsStore {
    inner: RwLock<HashMap<String, InstanceHistory>>,
}

impl MetricsStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Newest sample for the instance, only if it belongs to process `pid`.
    pub fn latest(&self, id: &str, pid: u32) -> Option<MetricSample> {
        let map = self.inner.read().unwrap();
        let history = map.get(id).filter(|h| h.pid == pid)?;
        history.samples.iter().next().copied()
    }

    /// Up to the last `count` samples, oldest first.
    pub fn history(&self, id: &str, count: usize) -> Vec<MetricSample> {
        let map = self.inner.read().unwrap();
        let Some(history) = map.get(id) else {
            return Vec::new();
        };
        let mut samples: Vec<MetricSample> = history.samples.iter().take(count).copied().collect();
        samples.reverse();
        samples
    }

    fn record(&self, id: &str, pid: u32, sample: MetricSample) {
        let mut map = self.inner.write().unwrap();
        let history = map.entry(id.to_string()).or_insert_with(|| InstanceHistory {
            pid,
            samples: CircularQueue::with_capacity(HISTORY_CAPACITY),
        });
        if history.pid != pid {
            // New process (restart): previous run's history no longer applies.
            history.pid = pid;
            history.samples.clear();
        }
        history.samples.push(sample);
    }

    fn retain(&self, ids: &HashSet<String>) {
        self.inner.write().unwrap().retain(|id, _| ids.contains(id));
    }
}

/// Spawns the sampling task.
pub fn spawn(instance_manager: Arc<InstanceManager>, store: Arc<MetricsStore>) {
    tokio::spawn(async move {
        let mut system = System::new();
        system.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());

        let mut ticker = interval(SAMPLE_INTERVAL);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;

            let mut all_ids = HashSet::new();
            let mut running: Vec<(String, u32)> = Vec::new();
            for runtime in instance_manager.list().await {
                let runtime = runtime.lock().await;
                all_ids.insert(runtime.config.id.clone());
                if let Some(pid) = runtime.process_id {
                    running.push((runtime.config.id.clone(), pid));
                }
            }
            store.retain(&all_ids);

            if running.is_empty() {
                continue;
            }

            // sysinfo reads /proc synchronously; keep it off the async workers.
            let result = tokio::task::spawn_blocking(move || {
                let pids: Vec<Pid> = running.iter().map(|(_, pid)| Pid::from_u32(*pid)).collect();
                system.refresh_processes_specifics(
                    ProcessesToUpdate::Some(&pids),
                    true,
                    ProcessRefreshKind::nothing().with_cpu().with_memory(),
                );

                let cpus_count = system.cpus().len().max(1) as f32;
                let t = Utc::now().timestamp_millis();
                let samples: Vec<(String, u32, MetricSample)> = running
                    .into_iter()
                    .filter_map(|(id, pid)| {
                        let proc = system.process(Pid::from_u32(pid))?;
                        let sample = MetricSample {
                            t,
                            cpu: (proc.cpu_usage() / cpus_count).clamp(0.0, 100.0),
                            ram_mb: proc.memory() / 1024 / 1024,
                            uptime_s: proc.run_time(),
                        };
                        Some((id, pid, sample))
                    })
                    .collect();
                (system, samples)
            })
            .await;

            match result {
                Ok((sys, samples)) => {
                    system = sys;
                    for (id, pid, sample) in samples {
                        store.record(&id, pid, sample);
                    }
                }
                Err(e) => {
                    error!("Metrics sampling task failed: {e}");
                    system = System::new();
                    system.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(t: i64) -> MetricSample {
        MetricSample { t, cpu: t as f32, ram_mb: t as u64, uptime_s: 0 }
    }

    #[test]
    fn ring_wraps_and_history_is_ordered() {
        let store = MetricsStore::new();
        for t in 0..(HISTORY_CAPACITY as i64 + 50) {
            store.record("a", 1, sample(t));
        }
        let all = store.history("a", usize::MAX);
        assert_eq!(all.len(), HISTORY_CAPACITY);
        assert_eq!(all.first().unwrap().t, 50);

        let last_min = store.history("a", 60);
        assert_eq!(last_min.len(), 60);
        assert!(last_min.windows(2).all(|w| w[0].t < w[1].t));
        assert_eq!(last_min.last().unwrap().t, HISTORY_CAPACITY as i64 + 49);
        assert_eq!(store.latest("a", 1).unwrap().t, HISTORY_CAPACITY as i64 + 49);
    }

    #[test]
    fn pid_change_resets_history() {
        let store = MetricsStore::new();
        store.record("a", 1, sample(1));
        store.record("a", 1, sample(2));
        assert_eq!(store.latest("a", 2), None);

        store.record("a", 2, sample(3));
        assert_eq!(store.history("a", 60), vec![sample(3)]);
        assert_eq!(store.latest("a", 1), None);
    }

    #[test]
    fn retain_drops_removed_instances() {
        let store = MetricsStore::new();
        store.record("a", 1, sample(1));
        store.record("b", 2, sample(1));
        store.retain(&HashSet::from(["a".to_string()]));
        assert!(store.history("b", 60).is_empty());
        assert_eq!(store.history("a", 60).len(), 1);
    }
}
