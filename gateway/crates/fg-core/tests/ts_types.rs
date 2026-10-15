//! Contract test: `src/gateway/types.gen.ts` must match what the Rust types generate.
//!
//! Run with `FG_UPDATE_TYPES=1` to rewrite the file after a deliberate change to the model.

use std::path::PathBuf;

fn target() -> PathBuf {
    // gateway/crates/fg-core -> repository root -> src/gateway/types.gen.ts
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../src/gateway/types.gen.ts")
}

#[test]
fn generated_typescript_is_up_to_date() {
    let expected = fg_core::ts_export::render();
    let path = target();
    if std::env::var_os("FG_UPDATE_TYPES").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &expected).unwrap();
        return;
    }
    let actual = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        actual == expected,
        "src/gateway/types.gen.ts is stale or missing. Regenerate it with:\n  \
         FG_UPDATE_TYPES=1 cargo test -p fg-core --test ts_types\nand commit the result."
    );
}

#[test]
fn rendering_is_deterministic() {
    assert_eq!(fg_core::ts_export::render(), fg_core::ts_export::render());
}

#[test]
fn contract_uses_numbers_for_millisecond_timestamps_and_no_bigint() {
    let ts = fg_core::ts_export::render();
    assert!(!ts.contains("bigint"), "64-bit integers must map to number");
    assert!(ts.contains("as_of_ms: number"));
}

#[test]
fn contract_keeps_the_user_facing_dash_rule() {
    // The generated file is shown to maintainers only, but the project forbids the em dash everywhere.
    assert!(!fg_core::ts_export::render().contains('\u{2014}'));
}
