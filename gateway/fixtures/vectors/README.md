# Shared test vectors

Each `*.json` file exercises one function of `fg-core` and is executed by two runners that must
agree: `cargo test -p fg-core --test vectors` and, for the browser direct mode, vitest. A vector is
the executable contract between the Rust and the TypeScript implementations.

```json
{
  "function": "drawdown.compute",
  "description": "...",
  "defaults": { },
  "cases": [ { "name": "...", "input": { }, "expected": { } } ]
}
```

* `function` is the name the runners dispatch on (`module.function`). A file per function, named
  after it.
* `input` is the JSON form of the function arguments (see `src/gateway/types.gen.ts` for the
  shapes). `defaults` is laid over each input where the function documents it
  (`alerts.evaluate_bot`: `defaults.ctx`).
* `expected` is a **subset** of the output: objects are compared key by key (extra keys in the
  output are ignored), arrays must have the same length and order, numbers match within 1e-9
  (relative), everything else must be equal. Absent keys in `expected` are not checked.
* Enumerations use their serialised names (`"xyz_stocks"`, `"Europe/Paris"`, `"24h"`). Timestamps are integer milliseconds.
* Expected values are written by hand or computed independently (Python `zoneinfo` for time zones),
  never produced by running the code under test.

To add a case, append to the file, run `cargo test -p fg-core --test vectors`, and make the
TypeScript runner pass on the same file.
