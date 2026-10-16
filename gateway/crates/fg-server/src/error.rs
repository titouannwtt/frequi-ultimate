//! Errors of the REST API: a status, a machine-readable code and a message that never carries a
//! secret, a path or a raw upstream answer.

use axum::Json;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use fg_core::protocol::{ApiError, ErrorCode};
use fg_engine::{ActionError, EngineError};
use fg_sources::botrest::RestError;
use serde::de::DeserializeOwned;

/// A failed request.
#[derive(Debug, Clone)]
pub struct ApiFailure {
    pub status: StatusCode,
    pub error: ApiError,
}

impl ApiFailure {
    #[must_use]
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::from_u16(code.http_status()).unwrap_or(StatusCode::BAD_REQUEST),
            error: ApiError {
                code,
                message: message.into(),
                retry_after_ms: None,
            },
        }
    }

    #[must_use]
    pub fn with_status(mut self, status: StatusCode) -> Self {
        self.status = status;
        self
    }

    #[must_use]
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::BadRequest, message)
    }

    #[must_use]
    pub fn unauthorized() -> Self {
        Self::new(ErrorCode::Unauthorized, "authentication required")
    }

    #[must_use]
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Forbidden, message)
    }

    #[must_use]
    pub fn not_found() -> Self {
        Self::new(ErrorCode::NotFound, "not found")
    }

    #[must_use]
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unavailable, message)
    }

    /// Feature the gateway does not provide (501).
    #[must_use]
    pub fn not_implemented(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unavailable, message).with_status(StatusCode::NOT_IMPLEMENTED)
    }

    #[must_use]
    pub fn rate_limited(retry_after_ms: u64) -> Self {
        let mut f = Self::new(ErrorCode::RateLimited, "too many attempts, try again later");
        f.error.retry_after_ms = Some(retry_after_ms);
        f
    }
}

impl IntoResponse for ApiFailure {
    fn into_response(self) -> Response {
        let retry = self.error.retry_after_ms;
        let mut resp = (self.status, Json(self.error)).into_response();
        if let Some(ms) = retry
            && let Ok(v) = HeaderValue::from_str(&ms.div_ceil(1000).max(1).to_string())
        {
            resp.headers_mut().insert(header::RETRY_AFTER, v);
        }
        resp
    }
}

impl From<EngineError> for ApiFailure {
    fn from(e: EngineError) -> Self {
        let code = e.code();
        let message = match &e {
            EngineError::BadRequest(m) => m.clone(),
            EngineError::Store(_) => match code {
                ErrorCode::StateMismatch => "the stored version differs from If-Match".to_owned(),
                ErrorCode::BadRequest => "document too large or too many documents".to_owned(),
                _ => "storage error".to_owned(),
            },
            other => other.to_string(),
        };
        Self::new(code, message)
    }
}

impl From<ActionError> for ApiFailure {
    fn from(e: ActionError) -> Self {
        Self::new(e.code, e.message)
    }
}

/// How a failed call to a bot is told to the client: no raw message, no URL.
#[must_use]
pub fn rest_failure(e: &RestError) -> ApiFailure {
    match e {
        RestError::NotFound => ApiFailure::not_found(),
        RestError::Timeout => {
            ApiFailure::new(ErrorCode::BotUnreachable, "the bot did not answer in time")
                .with_status(StatusCode::GATEWAY_TIMEOUT)
        }
        RestError::Starting => ApiFailure::new(ErrorCode::BotUnreachable, "the bot is starting"),
        RestError::AuthFailed | RestError::Unauthorized => ApiFailure::new(
            ErrorCode::BotUnreachable,
            "the gateway cannot authenticate to the bot",
        ),
        _ => ApiFailure::new(ErrorCode::BotUnreachable, "the bot is not reachable"),
    }
}

/// `Json<T>` that answers a malformed body with an [`ApiFailure`] instead of plain text.
pub struct ApiJson<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for ApiJson<T> {
    type Rejection = ApiFailure;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(req, state).await {
            Ok(Json(v)) => Ok(Self(v)),
            Err(JsonRejection::BytesRejection(_)) => Err(ApiFailure::new(
                ErrorCode::BadRequest,
                "request body too large or unreadable",
            )
            .with_status(StatusCode::PAYLOAD_TOO_LARGE)),
            Err(_) => Err(ApiFailure::bad_request("malformed JSON body")),
        }
    }
}

/// `Query<T>` with the same kind of rejection.
pub struct ApiQuery<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequestParts<S> for ApiQuery<T> {
    type Rejection = ApiFailure;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match axum::extract::Query::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Query(v)) => Ok(Self(v)),
            Err(QueryRejection::FailedToDeserializeQueryString(_)) => {
                Err(ApiFailure::bad_request("invalid query string"))
            }
            Err(_) => Err(ApiFailure::bad_request("invalid query string")),
        }
    }
}
