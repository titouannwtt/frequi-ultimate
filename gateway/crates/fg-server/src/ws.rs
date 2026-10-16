//! `GET /gw/v1/ws`: one multiplexed WebSocket per client (03 section 6.2).
//!
//! The token travels in the first frame, never in the URL. After `auth` the client subscribes to
//! channels (`sub`, with `resume` sequence numbers) and receives keyed upserts with per-channel
//! sequence numbers, heartbeats, and a `resync` whenever it cannot be given the exact frames it
//! missed. A client that reads too slowly gets its queue flushed and a `resync`: it never slows
//! the engine or the other clients.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use fg_core::protocol::{
    AUTH_TIMEOUT_S, CLIENT_QUEUE_SIZE, Channel, ClientFrame, ErrorCode, HEARTBEAT_INTERVAL_S,
    PROTOCOL_VERSION, ResyncReason, ServerFrame, close_code,
};
use fg_engine::Subscription;
use tokio::sync::{Notify, mpsc};
use tokio::task::JoinHandle;
use tokio::time::{interval, timeout};

use crate::routes::data::parse_channels;
use crate::session::{Session, WsSlot};
use crate::state::{AppState, Client};
use crate::util::now_ms;

/// Largest frame a client may send.
const MAX_CLIENT_FRAME: usize = 64 * 1024;
/// Channels one socket may hold.
const MAX_CHANNELS: usize = 32;
/// Malformed frames tolerated before the socket is closed.
const MAX_BAD_FRAMES: u32 = 10;
/// A client that does not accept a frame within this time is dropped.
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn handler(
    State(st): State<AppState>,
    Extension(client): Extension<Client>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let origin_ok = headers
        .get(header::ORIGIN)
        .is_none_or(|o| o.to_str().is_ok_and(|o| st.origin_allowed(o)));
    // Sockets waiting for their auth frame are capped: they cost nothing but a task each.
    let Ok(permit) = Arc::clone(&st.ws_pending).try_acquire_owned() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "busy").into_response();
    };
    ws.max_message_size(MAX_CLIENT_FRAME)
        .max_frame_size(MAX_CLIENT_FRAME)
        .on_upgrade(move |socket| async move {
            serve(st, client, origin_ok, socket, permit).await;
        })
}

async fn close(socket: &mut WebSocket, code: u16, reason: &str) {
    let _ = timeout(
        Duration::from_secs(2),
        socket.send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.to_owned().into(),
        }))),
    )
    .await;
}

async fn send(socket: &mut WebSocket, frame: &ServerFrame) -> bool {
    let Ok(text) = serde_json::to_string(frame) else {
        return true;
    };
    matches!(
        timeout(SEND_TIMEOUT, socket.send(Message::Text(text.into()))).await,
        Ok(Ok(()))
    )
}

fn err(code: ErrorCode, message: &str) -> ServerFrame {
    ServerFrame::Err {
        code,
        message: message.to_owned(),
    }
}

/// Wait for the `auth` frame and turn it into a session.
async fn authenticate(st: &AppState, client: &Client, socket: &mut WebSocket) -> Option<Session> {
    let first = timeout(Duration::from_secs(AUTH_TIMEOUT_S), socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        close(socket, close_code::UNAUTHORIZED, "auth required").await;
        return None;
    };
    let session = match serde_json::from_str::<ClientFrame>(text.as_str()) {
        Ok(ClientFrame::Auth { token, .. }) => st.sessions.lookup(&token),
        _ => None,
    };
    if session.is_none() {
        tracing::warn!(event = "auth_failed", ip = %client.ip, path = "/gw/v1/ws");
        close(socket, close_code::UNAUTHORIZED, "unauthorized").await;
    }
    session
}

struct Link {
    out_tx: mpsc::Sender<ServerFrame>,
    overflow: Arc<AtomicBool>,
    wake: Arc<Notify>,
}

/// Move the frames of a subscription into the client's bounded queue. A full queue does not
/// block the engine: the frame is dropped and the client is flagged, so that it is told to
/// reload its snapshots instead of being served a stream with holes.
fn pump(mut sub: Subscription, link: &Link) -> JoinHandle<()> {
    let out = link.out_tx.clone();
    let (overflow, wake) = (Arc::clone(&link.overflow), Arc::clone(&link.wake));
    tokio::spawn(async move {
        while let Some(frame) = sub.next().await {
            match out.try_send(frame) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_)) => {
                    overflow.store(true, Ordering::SeqCst);
                    wake.notify_one();
                }
                Err(mpsc::error::TrySendError::Closed(_)) => break,
            }
        }
    })
}

fn forward(
    st: &AppState,
    ch: &Channel,
    resume: Option<u64>,
    link: &Link,
) -> Result<(u64, JoinHandle<()>), fg_engine::EngineError> {
    let sub = st.engine.subscribe(&[(ch.clone(), resume)])?;
    let head = sub.heads.first().map_or(0, |(_, h)| *h);
    Ok((head, pump(sub, link)))
}

#[allow(clippy::too_many_lines)]
async fn serve(
    st: AppState,
    client: Client,
    origin_ok: bool,
    mut socket: WebSocket,
    pending: tokio::sync::OwnedSemaphorePermit,
) {
    if !origin_ok {
        tracing::warn!(event = "origin_refused", ip = %client.ip, path = "/gw/v1/ws");
        close(
            &mut socket,
            close_code::FORBIDDEN_ORIGIN,
            "origin not allowed",
        )
        .await;
        return;
    }
    let Some(session) = authenticate(&st, &client, &mut socket).await else {
        return;
    };
    drop(pending);
    let slot: Option<WsSlot> = st.sessions.ws_acquire(&session.id);
    let Some(_slot) = slot else {
        let _ = send(
            &mut socket,
            &err(
                ErrorCode::TooManyConnections,
                "too many sockets for this session",
            ),
        )
        .await;
        close(&mut socket, close_code::TOO_MANY, "too many sockets").await;
        return;
    };
    if !send(
        &mut socket,
        &ServerFrame::Authed {
            protocol: PROTOCOL_VERSION,
            ts: now_ms(),
            hb_interval_s: HEARTBEAT_INTERVAL_S,
        },
    )
    .await
    {
        return;
    }
    tracing::debug!(event = "ws_open", session = %session.id, ip = %client.ip);

    let (out_tx, mut out_rx) = mpsc::channel::<ServerFrame>(CLIENT_QUEUE_SIZE);
    let link = Link {
        out_tx,
        overflow: Arc::new(AtomicBool::new(false)),
        wake: Arc::new(Notify::new()),
    };
    let mut forwarders: HashMap<Channel, JoinHandle<()>> = HashMap::new();
    let mut revoked = st.sessions.revocations();
    let mut shutdown = st.shutdown.subscribe();
    let mut beat = interval(Duration::from_secs(HEARTBEAT_INTERVAL_S));
    beat.tick().await;
    let mut bad_frames = 0u32;

    'run: loop {
        tokio::select! {
            msg = socket.recv() => {
                let Some(Ok(msg)) = msg else { break 'run };
                let text = match msg {
                    Message::Text(t) => t,
                    Message::Close(_) => break 'run,
                    Message::Binary(_) => {
                        bad_frames += 1;
                        if !send(&mut socket, &err(ErrorCode::BadRequest, "text frames only")).await { break 'run }
                        if bad_frames >= MAX_BAD_FRAMES { close(&mut socket, 1008, "too many bad frames").await; break 'run }
                        continue;
                    }
                    _ => continue,
                };
                if !st.sessions.is_live(&session.id) {
                    close(&mut socket, close_code::UNAUTHORIZED, "session ended").await;
                    break 'run;
                }
                match serde_json::from_str::<ClientFrame>(text.as_str()) {
                    Ok(ClientFrame::Sub { ch, resume }) => {
                        let channels = match parse_channels(&st, &session, &ch) {
                            Ok(c) if forwarders.len() + c.len() <= MAX_CHANNELS => c,
                            Ok(_) => {
                                if !send(&mut socket, &err(ErrorCode::BadRequest, "too many channels")).await { break 'run }
                                continue;
                            }
                            Err(e) => {
                                if !send(&mut socket, &err(e.error.code, &e.error.message)).await { break 'run }
                                continue;
                            }
                        };
                        // Join first (nothing published from now on is lost), tell the heads,
                        // then start the flow so that `subscribed` precedes any replay.
                        let mut heads = std::collections::BTreeMap::new();
                        let mut joined: Vec<(Channel, JoinHandle<()>)> = Vec::new();
                        let mut failed = None;
                        for c in channels {
                            let name = c.to_string();
                            if let Some(old) = forwarders.remove(&c) { old.abort(); }
                            match forward(&st, &c, resume.get(&name).copied(), &link) {
                                Ok((head, task)) => { heads.insert(name, head); joined.push((c, task)); }
                                Err(e) => { failed = Some(e); break; }
                            }
                        }
                        if let Some(e) = failed {
                            for (_, t) in joined { t.abort(); }
                            if !send(&mut socket, &err(e.code(), &e.to_string())).await { break 'run }
                            continue;
                        }
                        if !send(&mut socket, &ServerFrame::Subscribed { seq: heads }).await {
                            for (_, t) in joined { t.abort(); }
                            break 'run;
                        }
                        forwarders.extend(joined);
                    }
                    Ok(ClientFrame::Unsub { ch }) => {
                        for n in ch {
                            if let Ok(c) = n.parse::<Channel>()
                                && let Some(t) = forwarders.remove(&c)
                            {
                                t.abort();
                            }
                        }
                    }
                    Ok(ClientFrame::Ping { .. }) => {
                        if !send(&mut socket, &ServerFrame::Hb { ts: now_ms() }).await { break 'run }
                    }
                    Ok(ClientFrame::Auth { .. }) => {
                        if !send(&mut socket, &err(ErrorCode::BadRequest, "already authenticated")).await { break 'run }
                    }
                    Err(_) => {
                        bad_frames += 1;
                        if !send(&mut socket, &err(ErrorCode::BadRequest, "malformed frame")).await { break 'run }
                        if bad_frames >= MAX_BAD_FRAMES { close(&mut socket, 1008, "too many bad frames").await; break 'run }
                    }
                }
            }
            frame = out_rx.recv() => {
                let Some(frame) = frame else { break 'run };
                if !send(&mut socket, &frame).await { break 'run }
            }
            () = link.wake.notified() => {
                if link.overflow.swap(false, Ordering::SeqCst) {
                    // The client is behind: drop what is queued and have it reload the snapshots.
                    while out_rx.try_recv().is_ok() {}
                    let names: Vec<String> = forwarders.keys().map(ToString::to_string).collect();
                    for ch in names {
                        let f = ServerFrame::Resync { ch, reason: ResyncReason::Overflow };
                        if !send(&mut socket, &f).await { break 'run }
                    }
                }
            }
            _ = beat.tick() => {
                if !st.sessions.is_live(&session.id) {
                    close(&mut socket, close_code::UNAUTHORIZED, "session ended").await;
                    break 'run;
                }
                if !send(&mut socket, &ServerFrame::Hb { ts: now_ms() }).await { break 'run }
            }
            id = revoked.recv() => {
                match id {
                    Ok(id) if id != session.id => {}
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        close(&mut socket, close_code::UNAUTHORIZED, "session revoked").await;
                        break 'run;
                    }
                    // Missed some revocations: look at our own session.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        if !st.sessions.is_live(&session.id) {
                            close(&mut socket, close_code::UNAUTHORIZED, "session revoked").await;
                            break 'run;
                        }
                    }
                }
            }
            _ = shutdown.changed() => {
                close(&mut socket, close_code::GOING_AWAY, "server going away").await;
                break 'run;
            }
        }
    }
    for (_, t) in forwarders {
        t.abort();
    }
    tracing::debug!(event = "ws_close", session = %session.id);
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use fg_engine::hub::Hub;
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn a_client_that_does_not_read_is_flagged_instead_of_blocking_the_engine() {
        let hub = Hub::new(0);
        let (out_tx, mut out_rx) = mpsc::channel(4);
        let link = Link {
            out_tx,
            overflow: Arc::new(AtomicBool::new(false)),
            wake: Arc::new(Notify::new()),
        };
        let sub = Subscription::new(&hub, &[(Channel::Fleet, None)]);
        let task = pump(sub, &link);
        for n in 0..30 {
            let mut up = BTreeMap::new();
            up.entry("bots".to_owned())
                .or_insert_with(BTreeMap::new)
                .insert("local:1".to_owned(), json!({"metrics": {"n": n}}));
            hub.publish_up(&Channel::Fleet, n, up, BTreeMap::new());
            tokio::task::yield_now().await;
        }
        tokio::time::timeout(Duration::from_secs(2), link.wake.notified())
            .await
            .expect("the writer is woken");
        assert!(link.overflow.swap(false, Ordering::SeqCst));
        // The writer drains the queue and sends a resync; the queue works again afterwards.
        while out_rx.try_recv().is_ok() {}
        let mut up = BTreeMap::new();
        up.entry("bots".to_owned())
            .or_insert_with(BTreeMap::new)
            .insert("local:1".to_owned(), json!({"metrics": {"n": 99}}));
        hub.publish_up(&Channel::Fleet, 99, up, BTreeMap::new());
        let next = tokio::time::timeout(Duration::from_secs(2), out_rx.recv())
            .await
            .expect("frames flow again")
            .expect("open");
        assert!(next.seq().is_some());
        task.abort();
    }
}
