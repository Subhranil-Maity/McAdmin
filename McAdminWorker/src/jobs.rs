//! Background jobs (content installs, identify, modpacks) with progress that the
//! UI can poll (`GET /api/jobs/{id}`) or receive over the instance WebSocket.

use chrono::Utc;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

use crate::instance_runtime::LogBuffer;

/// Finished jobs are kept this long so clients can read the result.
const FINISHED_RETENTION: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobInfo {
    pub id: String,
    pub instance_id: String,
    pub kind: String,
    pub title: String,
    pub state: JobState,
    pub done: u64,
    pub total: u64,
    pub message: String,
    pub error: Option<String>,
    /// Seconds remaining in a Modrinth rate-limit wait (0 when not waiting).
    pub waiting_secs: u64,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub result: Option<serde_json::Value>,
}

struct Entry {
    info: JobInfo,
    finished: Option<Instant>,
}

pub struct JobRegistry {
    jobs: Mutex<HashMap<String, Entry>>,
    /// Instances with an exclusive (content-writing) job running.
    busy: Mutex<HashSet<String>>,
    tx: broadcast::Sender<JobInfo>,
}

#[derive(Debug)]
pub struct JobConflict;

impl JobRegistry {
    pub fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(256);
        Arc::new(Self {
            jobs: Mutex::new(HashMap::new()),
            busy: Mutex::new(HashSet::new()),
            tx,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<JobInfo> {
        self.tx.subscribe()
    }

    /// Registers a new running job. Only one job per instance may run at a time.
    pub fn start(
        self: &Arc<Self>,
        instance_id: &str,
        kind: &str,
        title: impl Into<String>,
        logs: Option<LogBuffer>,
    ) -> Result<JobHandle, JobConflict> {
        {
            let mut busy = self.busy.lock().unwrap();
            if !busy.insert(instance_id.to_string()) {
                return Err(JobConflict);
            }
        }
        self.prune();

        let id = uuid::Uuid::new_v4().to_string();
        let info = JobInfo {
            id: id.clone(),
            instance_id: instance_id.to_string(),
            kind: kind.to_string(),
            title: title.into(),
            state: JobState::Running,
            done: 0,
            total: 0,
            message: "Starting...".to_string(),
            error: None,
            waiting_secs: 0,
            started_at: Utc::now().to_rfc3339(),
            finished_at: None,
            result: None,
        };
        self.jobs.lock().unwrap().insert(
            id.clone(),
            Entry {
                info: info.clone(),
                finished: None,
            },
        );
        let _ = self.tx.send(info);
        Ok(JobHandle {
            id,
            registry: self.clone(),
            logs,
            finished: false,
        })
    }

    pub fn get(&self, id: &str) -> Option<JobInfo> {
        self.jobs.lock().unwrap().get(id).map(|e| e.info.clone())
    }

    /// Jobs for an instance: running ones plus recently finished ones.
    pub fn for_instance(&self, instance_id: &str) -> Vec<JobInfo> {
        self.prune();
        let mut list: Vec<JobInfo> = self
            .jobs
            .lock()
            .unwrap()
            .values()
            .filter(|e| e.info.instance_id == instance_id)
            .map(|e| e.info.clone())
            .collect();
        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        list
    }

    pub fn is_busy(&self, instance_id: &str) -> bool {
        self.busy.lock().unwrap().contains(instance_id)
    }

    fn prune(&self) {
        self.jobs
            .lock()
            .unwrap()
            .retain(|_, e| e.finished.is_none_or(|t| t.elapsed() < FINISHED_RETENTION));
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut JobInfo)) {
        let snapshot = {
            let mut jobs = self.jobs.lock().unwrap();
            let Some(entry) = jobs.get_mut(id) else {
                return;
            };
            f(&mut entry.info);
            if entry.info.state != JobState::Running && entry.finished.is_none() {
                entry.finished = Some(Instant::now());
            }
            entry.info.clone()
        };
        if snapshot.state != JobState::Running {
            self.busy.lock().unwrap().remove(&snapshot.instance_id);
        }
        let _ = self.tx.send(snapshot);
    }
}

/// Handle owned by the task doing the work. Dropping it without finishing marks
/// the job failed (e.g. on panic), so an instance never stays locked.
pub struct JobHandle {
    pub id: String,
    registry: Arc<JobRegistry>,
    logs: Option<LogBuffer>,
    finished: bool,
}

impl JobHandle {
    pub fn set_total(&self, total: u64) {
        self.registry.update(&self.id, |j| j.total = total);
    }

    pub fn add_total(&self, n: u64) {
        self.registry.update(&self.id, |j| j.total += n);
    }

    /// Updates the status message (also mirrored to the instance console).
    pub fn message(&self, msg: impl Into<String>) {
        let msg = msg.into();
        if let Some(logs) = &self.logs {
            logs.push(format!("[McAdmin] {msg}"));
        }
        self.registry.update(&self.id, |j| {
            j.message = msg;
            j.waiting_secs = 0;
        });
    }

    /// Updates the status message without writing to the console.
    pub fn quiet_message(&self, msg: impl Into<String>) {
        let msg = msg.into();
        self.registry.update(&self.id, |j| j.message = msg);
    }

    pub fn advance(&self) {
        self.registry.update(&self.id, |j| j.done += 1);
    }

    /// Reports a Modrinth rate-limit pause.
    pub fn waiting(&self, secs: u64) {
        self.registry.update(&self.id, |j| {
            j.waiting_secs = secs;
            j.message = format!("Rate-limited by Modrinth, resuming in {secs}s");
        });
    }

    pub fn succeed(mut self, msg: impl Into<String>, result: Option<serde_json::Value>) {
        self.finished = true;
        let msg = msg.into();
        if let Some(logs) = &self.logs {
            logs.push(format!("[McAdmin] {msg}"));
        }
        self.registry.update(&self.id, |j| {
            j.state = JobState::Done;
            j.done = j.total.max(j.done);
            j.message = msg;
            j.waiting_secs = 0;
            j.result = result;
            j.finished_at = Some(Utc::now().to_rfc3339());
        });
    }

    pub fn fail(mut self, err: impl Into<String>) {
        self.finished = true;
        let err = err.into();
        if let Some(logs) = &self.logs {
            logs.push(format!("[ERROR] [McAdmin] {err}"));
        }
        self.registry.update(&self.id, |j| {
            j.state = JobState::Failed;
            j.message = err.clone();
            j.error = Some(err);
            j.waiting_secs = 0;
            j.finished_at = Some(Utc::now().to_rfc3339());
        });
    }
}

impl Drop for JobHandle {
    fn drop(&mut self) {
        if !self.finished {
            self.registry.update(&self.id, |j| {
                j.state = JobState::Failed;
                j.error = Some("Job aborted unexpectedly".to_string());
                j.message = "Job aborted unexpectedly".to_string();
                j.finished_at = Some(Utc::now().to_rfc3339());
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_job_per_instance_and_release_on_finish() {
        let reg = JobRegistry::new();
        let job = reg.start("i1", "install", "Install", None).unwrap();
        assert!(reg.start("i1", "install", "Again", None).is_err());
        assert!(reg.start("i2", "install", "Other", None).is_ok());
        job.set_total(2);
        job.advance();
        let id = job.id.clone();
        assert_eq!(reg.get(&id).unwrap().done, 1);
        job.succeed("ok", None);
        assert_eq!(reg.get(&id).unwrap().state, JobState::Done);
        assert!(!reg.is_busy("i1"));
        assert!(reg.start("i1", "install", "Now ok", None).is_ok());
    }

    #[test]
    fn dropped_job_is_failed() {
        let reg = JobRegistry::new();
        let id = {
            let job = reg.start("i1", "x", "X", None).unwrap();
            job.id.clone()
        };
        assert_eq!(reg.get(&id).unwrap().state, JobState::Failed);
        assert!(!reg.is_busy("i1"));
    }
}
