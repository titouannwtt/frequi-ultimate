//! Process-wide logging: structured lines on stdout, scrubbed of credentials (03 section 3.4).

use tracing_subscriber::EnvFilter;

use crate::config::LogSection;
use crate::redact::RedactingMakeWriter;

/// Install the global subscriber. `RUST_LOG` wins over the configured level.
pub fn init(log: &LogSection) {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(log.level.as_str()));
    let writer = RedactingMakeWriter::new(std::io::stdout());
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_target(true);
    let _ = if log.format == "text" {
        builder.try_init()
    } else {
        builder.json().try_init()
    };
    // A panic message may quote the data being handled: print where it happened, nothing else.
    std::panic::set_hook(Box::new(|info| {
        let (file, line) = info.location().map_or(("?", 0), |l| (l.file(), l.line()));
        tracing::error!(event = "panic", file, line);
    }));
}
