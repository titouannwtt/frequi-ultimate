//! Per-channel delta buffers and fan-out to subscribers (03 section 6.2).
//!
//! One [`Hub`] holds, for every channel, a [`DeltaBuffer`] (the last 512 frames, for resume) and a
//! broadcast sender. Publishing and subscribing both happen under the same lock, so a subscriber
//! gets exactly the frames after the point it resumed from or subscribed at: no gap, no
//! duplicate. A subscriber whose queue overflows is told to resynchronise, never silently
//! skipped.

use std::collections::HashMap;
use std::sync::Mutex;

use fg_core::model::Event;
use fg_core::protocol::{
    CLIENT_QUEUE_SIZE, Channel, DELTA_BUFFER_SIZE, DeltaBuffer, Remove, Resume, ResyncReason,
    ServerFrame, Upsert,
};
use futures_util::stream::{self, SelectAll, StreamExt};
use tokio::sync::broadcast;

struct Chan {
    buf: DeltaBuffer,
    tx: broadcast::Sender<ServerFrame>,
}

/// The delta buffers of all channels.
pub struct Hub {
    base: u64,
    chans: Mutex<HashMap<Channel, Chan>>,
}

/// What a subscriber starts with.
pub struct Joined {
    /// `resync` for a resume the buffer cannot honour, or the frames that were missed.
    pub initial: Vec<ServerFrame>,
    /// Sequence number of the channel at the moment of joining.
    pub head: u64,
    rx: broadcast::Receiver<ServerFrame>,
}

/// Publisher handed to [`Hub::transaction`].
pub struct HubTx<'a> {
    base: u64,
    chans: &'a mut HashMap<Channel, Chan>,
}

impl HubTx<'_> {
    fn chan(&mut self, ch: &Channel) -> &mut Chan {
        let base = self.base;
        self.chans.entry(ch.clone()).or_insert_with(|| Chan {
            buf: DeltaBuffer::with_base(ch, DELTA_BUFFER_SIZE, base),
            tx: broadcast::channel(CLIENT_QUEUE_SIZE).0,
        })
    }

    /// Whether anyone is subscribed to the channel.
    pub fn watched(&mut self, ch: &Channel) -> bool {
        self.chans
            .get(ch)
            .is_some_and(|c| c.tx.receiver_count() > 0)
    }

    pub fn up(&mut self, ch: &Channel, ts: i64, upsert: Upsert, remove: Remove) {
        let c = self.chan(ch);
        let frame = c.buf.push_up(ts, upsert, remove);
        // Nobody listening is fine: the buffer keeps the frame for a later resume.
        let _ = c.tx.send(frame);
    }

    pub fn ev(&mut self, ch: &Channel, ev: Event) {
        let c = self.chan(ch);
        let frame = c.buf.push_ev(ev);
        let _ = c.tx.send(frame);
    }
}

impl Hub {
    /// `base` is the process sequence base ([`fg_core::protocol::boot_seq_base`]).
    #[must_use]
    pub fn new(base: u64) -> Self {
        Self {
            base,
            chans: Mutex::new(HashMap::new()),
        }
    }

    fn with<T>(&self, ch: &Channel, f: impl FnOnce(&mut Chan) -> T) -> T {
        let mut map = self
            .chans
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let chan = map.entry(ch.clone()).or_insert_with(|| Chan {
            buf: DeltaBuffer::with_base(ch, DELTA_BUFFER_SIZE, self.base),
            tx: broadcast::channel(CLIENT_QUEUE_SIZE).0,
        });
        f(chan)
    }

    /// Read a consistent pair: the head sequence number of `ch` and whatever `f` reads while no
    /// frame can be published (the published state is swapped under the same lock).
    pub fn at_head<T>(&self, ch: &Channel, f: impl FnOnce() -> T) -> (u64, T) {
        self.with(ch, |c| (c.buf.head(), f()))
    }

    /// Publish several frames, then run `after` (the swap of the published state), all under one
    /// lock: a reader of [`Self::at_head`] sees either everything or nothing of the batch.
    pub fn transaction<T>(&self, f: impl FnOnce(&mut HubTx<'_>) -> T) -> T {
        let mut map = self
            .chans
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut tx = HubTx {
            base: self.base,
            chans: &mut map,
        };
        f(&mut tx)
    }

    /// Current sequence number of a channel.
    #[must_use]
    pub fn head(&self, ch: &Channel) -> u64 {
        self.with(ch, |c| c.buf.head())
    }

    /// Number of live subscribers of a channel (0 for a channel nobody joined).
    #[must_use]
    pub fn subscribers(&self, ch: &Channel) -> usize {
        let map = self
            .chans
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        map.get(ch).map_or(0, |c| c.tx.receiver_count())
    }

    /// Record and broadcast an `up` frame.
    pub fn publish_up(&self, ch: &Channel, ts: i64, upsert: Upsert, remove: Remove) {
        self.transaction(|tx| tx.up(ch, ts, upsert, remove));
    }

    /// Record and broadcast an `ev` frame.
    pub fn publish_ev(&self, ch: &Channel, ev: Event) {
        self.transaction(|tx| tx.ev(ch, ev));
    }

    /// Join a channel. `resume` is the last sequence number the client applied, if any.
    #[must_use]
    pub fn join(&self, ch: &Channel, resume: Option<u64>) -> Joined {
        self.with(ch, |c| {
            let head = c.buf.head();
            let initial = match resume.map(|r| c.buf.resume(r)) {
                None | Some(Resume::UpToDate) => Vec::new(),
                Some(Resume::Replay(frames)) => frames,
                Some(Resume::Resync(reason)) => vec![ServerFrame::Resync {
                    ch: ch.to_string(),
                    reason,
                }],
            };
            Joined {
                initial,
                head,
                rx: c.tx.subscribe(),
            }
        })
    }
}

/// The frames of one or several channels for one client, in channel order. A client that falls
/// behind its queue gets a `resync` for the channel instead of the lost frames.
pub struct Subscription {
    /// Frames to send before anything live: replays and resyncs.
    initial: std::vec::IntoIter<ServerFrame>,
    /// Current sequence number of each joined channel.
    pub heads: Vec<(Channel, u64)>,
    live: SelectAll<std::pin::Pin<Box<dyn futures_util::Stream<Item = ServerFrame> + Send>>>,
    /// Views kept alive for as long as the subscription lives.
    _guards: Vec<crate::views::ViewGuard>,
}

impl Subscription {
    /// Join several channels at once. `resume` maps a channel to the last sequence applied.
    #[must_use]
    pub fn new(hub: &Hub, channels: &[(Channel, Option<u64>)]) -> Self {
        let mut initial = Vec::new();
        let mut heads = Vec::new();
        let mut live = SelectAll::new();
        for (ch, resume) in channels {
            let joined = hub.join(ch, *resume);
            initial.extend(joined.initial);
            heads.push((ch.clone(), joined.head));
            let name = ch.to_string();
            live.push(Box::pin(stream::unfold(
                (joined.rx, name),
                |(mut rx, name)| async move {
                    match rx.recv().await {
                        Ok(frame) => Some((frame, (rx, name))),
                        // Frames were lost to a slow reader: have it reload the snapshot.
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            let frame = ServerFrame::Resync {
                                ch: name.clone(),
                                reason: ResyncReason::Overflow,
                            };
                            Some((frame, (rx, name)))
                        }
                        Err(broadcast::error::RecvError::Closed) => None,
                    }
                },
            ))
                as std::pin::Pin<
                    Box<dyn futures_util::Stream<Item = ServerFrame> + Send>,
                >);
        }
        Self {
            initial: initial.into_iter(),
            heads,
            live,
            _guards: Vec::new(),
        }
    }

    /// Keep these views (raised cadences) for as long as the subscription lives.
    #[must_use]
    pub fn with_views(mut self, guards: Vec<crate::views::ViewGuard>) -> Self {
        self._guards = guards;
        self
    }

    /// The next frame for the client, or `None` when the engine shut down.
    pub async fn next(&mut self) -> Option<ServerFrame> {
        if let Some(f) = self.initial.next() {
            return Some(f);
        }
        self.live.next().await
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;

    fn up(hub: &Hub, ch: &Channel, n: i64) {
        let mut u: Upsert = BTreeMap::new();
        u.entry("bots".into())
            .or_default()
            .insert("local:1".into(), json!({"metrics": {"n": n}}));
        hub.publish_up(ch, n, u, BTreeMap::new());
    }

    #[tokio::test]
    async fn a_resume_receives_exactly_the_missed_frames_then_live_ones() {
        let hub = Hub::new(1_000);
        let ch = Channel::Fleet;
        for n in 1..=3 {
            up(&hub, &ch, n);
        }
        // The client applied 1001 (the first frame) and resumes.
        let mut sub = Subscription::new(&hub, &[(ch.clone(), Some(1_001))]);
        assert_eq!(sub.heads, vec![(ch.clone(), 1_003)]);
        up(&hub, &ch, 4);
        let seqs: Vec<u64> = {
            let mut v = Vec::new();
            for _ in 0..3 {
                v.push(sub.next().await.unwrap().seq().unwrap());
            }
            v
        };
        assert_eq!(seqs, vec![1_002, 1_003, 1_004]);
    }

    #[tokio::test]
    async fn a_resume_from_another_incarnation_is_answered_with_a_resync() {
        let hub = Hub::new(5_000_000);
        up(&hub, &Channel::Fleet, 1);
        // A client of the previous process knows sequence 4_000_100: below this base.
        let mut sub = Subscription::new(&hub, &[(Channel::Fleet, Some(4_000_100))]);
        match sub.next().await.unwrap() {
            ServerFrame::Resync { ch, reason } => {
                assert_eq!(ch, "fleet");
                assert_eq!(reason, ResyncReason::StaleResume);
            }
            other => panic!("expected a resync, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_reader_that_overflows_its_queue_gets_a_resync_not_silence() {
        let hub = Hub::new(0);
        let ch = Channel::Alerts;
        let mut sub = Subscription::new(&hub, &[(ch.clone(), None)]);
        for n in 0..(CLIENT_QUEUE_SIZE as i64 + 50) {
            up(&hub, &ch, n);
        }
        match sub.next().await.unwrap() {
            ServerFrame::Resync { ch, reason } => {
                assert_eq!(ch, "alerts");
                assert_eq!(reason, ResyncReason::Overflow);
            }
            other => panic!("expected a resync, got {other:?}"),
        }
        // After the resync the stream continues with the frames still queued.
        assert!(sub.next().await.unwrap().seq().is_some());
    }

    #[tokio::test]
    async fn channels_are_independent_and_counted() {
        let hub = Hub::new(0);
        let a = Subscription::new(&hub, &[(Channel::Fleet, None), (Channel::Positions, None)]);
        assert_eq!(hub.subscribers(&Channel::Fleet), 1);
        assert_eq!(hub.subscribers(&Channel::Health), 0);
        up(&hub, &Channel::Fleet, 1);
        assert_eq!(hub.head(&Channel::Fleet), 1);
        assert_eq!(hub.head(&Channel::Positions), 0);
        drop(a);
        assert_eq!(hub.subscribers(&Channel::Fleet), 0);
    }
}
