//! Argon2id hashing for the `password` login mode and the `hash-password` command.

use argon2::Argon2;
use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};

/// Longest password accepted (Argon2 would take any length; this bounds the work of a request).
pub const MAX_PASSWORD_LEN: usize = 256;

/// Hash a password into a PHC string (`$argon2id$v=19$...`) with a random salt.
///
/// # Errors
/// The password is empty or too long, or the system random source failed.
pub fn hash_password(password: &str) -> Result<String, String> {
    if password.is_empty() || password.len() > MAX_PASSWORD_LEN {
        return Err(format!(
            "the password must have 1 to {MAX_PASSWORD_LEN} bytes"
        ));
    }
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|h| h.to_string())
        .map_err(|_| "hashing failed".to_owned())
}

/// Whether `password` matches the PHC string `hash`. Constant time in the password.
#[must_use]
pub fn verify_password(password: &str, hash: &str) -> bool {
    if password.len() > MAX_PASSWORD_LEN {
        return false;
    }
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hash_verifies_only_its_password_and_never_contains_it() {
        let h = hash_password("correct horse").unwrap();
        assert!(h.starts_with("$argon2id$"), "{h}");
        assert!(!h.contains("correct"));
        assert!(verify_password("correct horse", &h));
        assert!(!verify_password("correct horsf", &h));
        assert!(!verify_password("", &h));
        assert_ne!(h, hash_password("correct horse").unwrap(), "salted");
    }

    #[test]
    fn garbage_and_oversize_are_refused() {
        assert!(!verify_password("x", "not a hash"));
        assert!(!verify_password(
            &"a".repeat(MAX_PASSWORD_LEN + 1),
            "$argon2id$x"
        ));
        assert!(hash_password("").is_err());
        assert!(hash_password(&"a".repeat(MAX_PASSWORD_LEN + 1)).is_err());
    }
}
