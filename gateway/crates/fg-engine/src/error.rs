//! Errors of the engine API.

use fg_core::protocol::ErrorCode;
use thiserror::Error;

use crate::state_db::StateDbError;

/// Failure of an engine call. The messages carry no secret and no path.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EngineError {
    #[error("not found")]
    NotFound,
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("not supported: {0}")]
    Unsupported(&'static str),
    #[error("state database error")]
    Store(StateDbError),
    #[error("the engine is shutting down")]
    Closed,
}

impl From<StateDbError> for EngineError {
    fn from(e: StateDbError) -> Self {
        Self::Store(e)
    }
}

impl EngineError {
    /// The protocol error code a server layer should answer with.
    #[must_use]
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::NotFound => ErrorCode::NotFound,
            Self::BadRequest(_) => ErrorCode::BadRequest,
            Self::Unsupported(_) => ErrorCode::UnknownChannel,
            Self::Store(StateDbError::VersionMismatch { .. }) => ErrorCode::StateMismatch,
            Self::Store(StateDbError::TooLarge | StateDbError::TooMany) => ErrorCode::BadRequest,
            Self::Store(_) => ErrorCode::Internal,
            Self::Closed => ErrorCode::Unavailable,
        }
    }
}
