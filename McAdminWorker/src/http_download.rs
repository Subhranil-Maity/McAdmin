//! Shared HTTP client + verified streaming downloads used for Java runtimes,
//! server jars and Modrinth content. Everything is downloaded by the worker
//! itself; the browser never fetches or re-uploads these files.

use futures_util::StreamExt;
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};
use std::io;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

pub const USER_AGENT: &str = concat!(
    "McAdminWorker/",
    env!("CARGO_PKG_VERSION"),
    " (self-hosted Minecraft server manager)"
);

/// Process-wide HTTP client (connection pooling, rustls).
pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build HTTP client")
    })
}

/// An expected digest (lowercase or uppercase hex) of a downloaded file.
#[derive(Debug, Clone)]
pub enum Hash {
    Sha1(String),
    Sha256(String),
    Sha512(String),
}

impl Hash {
    fn expected(&self) -> &str {
        match self {
            Hash::Sha1(h) | Hash::Sha256(h) | Hash::Sha512(h) => h,
        }
    }

    fn name(&self) -> &'static str {
        match self {
            Hash::Sha1(_) => "sha1",
            Hash::Sha256(_) => "sha256",
            Hash::Sha512(_) => "sha512",
        }
    }
}

enum Hasher {
    None,
    Sha1(Sha1),
    Sha256(Sha256),
    Sha512(Sha512),
}

impl Hasher {
    fn new(expected: Option<&Hash>) -> Self {
        match expected {
            None => Hasher::None,
            Some(Hash::Sha1(_)) => Hasher::Sha1(Sha1::new()),
            Some(Hash::Sha256(_)) => Hasher::Sha256(Sha256::new()),
            Some(Hash::Sha512(_)) => Hasher::Sha512(Sha512::new()),
        }
    }

    fn update(&mut self, data: &[u8]) {
        match self {
            Hasher::None => {}
            Hasher::Sha1(h) => h.update(data),
            Hasher::Sha256(h) => h.update(data),
            Hasher::Sha512(h) => h.update(data),
        }
    }

    fn finalize(self) -> Option<String> {
        match self {
            Hasher::None => None,
            Hasher::Sha1(h) => Some(hex(&h.finalize())),
            Hasher::Sha256(h) => Some(hex(&h.finalize())),
            Hasher::Sha512(h) => Some(hex(&h.finalize())),
        }
    }
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn other_err(msg: impl Into<String>) -> io::Error {
    io::Error::other(msg.into())
}

/// Streams `url` to `dest`, verifying `expected` if given. The file is written to
/// a sibling temp file first and renamed into place only once complete and
/// verified. Progress (every 5%) is reported through `log` prefixed with `label`.
/// Returns the number of bytes written.
pub async fn download_to_file(
    url: &str,
    dest: &Path,
    expected: Option<Hash>,
    expected_size: Option<u64>,
    label: &str,
    log: &(dyn Fn(String) + Send + Sync),
) -> io::Result<u64> {
    let resp = client()
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| other_err(format!("Download of {label} failed: {e}")))?;
    let total = expected_size.or(resp.content_length());
    let mb = |b: u64| b as f64 / 1_048_576.0;

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let file_name = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".to_string());
    let tmp = dest.with_file_name(format!(".{file_name}.part"));

    log(match total {
        Some(t) => format!("Downloading {label} ({:.1} MB)...", mb(t)),
        None => format!("Downloading {label}..."),
    });

    let result: io::Result<(u64, Option<String>)> = async {
        let mut file = tokio::fs::File::create(&tmp).await?;
        let mut hasher = Hasher::new(expected.as_ref());
        let mut downloaded: u64 = 0;
        let mut last_step: u64 = 0;
        let mut stream = resp.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|e| other_err(format!("Download of {label} interrupted: {e}")))?;
            hasher.update(&chunk);
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            if let Some(t) = total.filter(|t| *t > 1_048_576) {
                let pct = downloaded * 100 / t;
                if pct / 5 > last_step {
                    last_step = pct / 5;
                    log(format!(
                        "Downloading {label}: {pct}% ({:.1}/{:.1} MB)",
                        mb(downloaded),
                        mb(t)
                    ));
                }
            }
        }
        file.flush().await?;
        Ok((downloaded, hasher.finalize()))
    }
    .await;

    let (downloaded, digest) = match result {
        Ok(v) => v,
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(e);
        }
    };

    if let (Some(expected), Some(digest)) = (expected.as_ref(), digest.as_deref()) {
        if !expected.expected().eq_ignore_ascii_case(digest) {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(other_err(format!(
                "Checksum mismatch for {label} ({} expected {}, got {digest})",
                expected.name(),
                expected.expected()
            )));
        }
    }

    tokio::fs::rename(&tmp, dest).await?;
    Ok(downloaded)
}

/// sha1 + sha512 of a file on disk, computed on a blocking thread.
pub async fn file_hashes(path: &Path) -> io::Result<(String, String)> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        use std::io::Read;
        let mut file = std::fs::File::open(&path)?;
        let mut s1 = Sha1::new();
        let mut s512 = Sha512::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            s1.update(&buf[..n]);
            s512.update(&buf[..n]);
        }
        Ok((hex(&s1.finalize()), hex(&s512.finalize())))
    })
    .await
    .map_err(|e| other_err(e.to_string()))?
}
