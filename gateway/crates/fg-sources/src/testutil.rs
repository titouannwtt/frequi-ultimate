//! Test helpers: a tiny HTTP/1.1 server driven by a closure.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

#[derive(Debug, Clone)]
pub(crate) struct FakeRequest {
    pub method: String,
    /// Path and query, as sent.
    pub target: String,
    /// Header names are lower-cased.
    pub headers: HashMap<String, String>,
    pub body: String,
}

impl FakeRequest {
    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or(&self.target)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct FakeResponse {
    pub status: u16,
    pub body: String,
    pub delay: Option<Duration>,
}

impl FakeResponse {
    pub fn json(status: u16, body: &str) -> Self {
        Self {
            status,
            body: body.to_owned(),
            delay: None,
        }
    }
}

pub(crate) struct FakeHttp {
    pub addr: SocketAddr,
    pub log: Arc<Mutex<Vec<FakeRequest>>>,
    task: JoinHandle<()>,
}

impl Drop for FakeHttp {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl FakeHttp {
    pub async fn start(
        handler: impl Fn(&FakeRequest) -> FakeResponse + Send + Sync + 'static,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let log = Arc::new(Mutex::new(Vec::new()));
        let handler = Arc::new(handler);
        let task = {
            let log = Arc::clone(&log);
            tokio::spawn(async move {
                loop {
                    let Ok((mut stream, _)) = listener.accept().await else {
                        break;
                    };
                    let (log, handler) = (Arc::clone(&log), Arc::clone(&handler));
                    tokio::spawn(async move {
                        let mut buf = Vec::new();
                        let mut chunk = [0u8; 4096];
                        let head_end = loop {
                            let n = stream.read(&mut chunk).await.unwrap_or(0);
                            if n == 0 {
                                return;
                            }
                            buf.extend_from_slice(&chunk[..n]);
                            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                                break i + 4;
                            }
                        };
                        let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
                        let mut lines = head.split("\r\n");
                        let mut first = lines.next().unwrap_or("").split(' ');
                        let method = first.next().unwrap_or("").to_owned();
                        let target = first.next().unwrap_or("").to_owned();
                        let headers: HashMap<String, String> = lines
                            .filter_map(|l| l.split_once(':'))
                            .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_owned()))
                            .collect();
                        let want: usize = headers
                            .get("content-length")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(0);
                        while buf.len() < head_end + want {
                            let n = stream.read(&mut chunk).await.unwrap_or(0);
                            if n == 0 {
                                break;
                            }
                            buf.extend_from_slice(&chunk[..n]);
                        }
                        let body =
                            String::from_utf8_lossy(&buf[head_end.min(buf.len())..]).into_owned();
                        let req = FakeRequest {
                            method,
                            target,
                            headers,
                            body,
                        };
                        log.lock().unwrap().push(req.clone());
                        let resp = handler(&req);
                        if let Some(d) = resp.delay {
                            tokio::time::sleep(d).await;
                        }
                        let out = format!(
                            "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            resp.status,
                            resp.body.len(),
                            resp.body
                        );
                        let _ = stream.write_all(out.as_bytes()).await;
                        let _ = stream.shutdown().await;
                    });
                }
            })
        };
        Self { addr, log, task }
    }

    pub fn requests(&self) -> Vec<FakeRequest> {
        self.log.lock().unwrap().clone()
    }

    pub fn count(&self, method: &str, path: &str) -> usize {
        self.requests()
            .iter()
            .filter(|r| r.method == method && r.path() == path)
            .count()
    }
}
