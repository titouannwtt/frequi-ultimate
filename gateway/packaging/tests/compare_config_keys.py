#!/usr/bin/env python3
"""Fail when config.example.toml misses a section or a key that `print-default-config` has.

    compare_config_keys.py DEFAULT.toml EXAMPLE.toml

Commented-out keys (`# socket = ...`) count as present, so an example may leave an optional key
commented. Keys only the example has are reported but allowed.
"""
import re
import sys

SECTION = re.compile(r"^\s*\[([A-Za-z0-9_.]+)\]\s*$")
KEY = re.compile(r"^\s*#?\s*([a-z][a-z0-9_]*)\s*=")


def keys(path):
    found, section = set(), ""
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = SECTION.match(line)
            if m:
                section = m.group(1)
                found.add(section + ".")
                continue
            m = KEY.match(line)
            if m:
                found.add(f"{section}.{m.group(1)}")
    return found


def main():
    default, example = keys(sys.argv[1]), keys(sys.argv[2])
    missing = sorted(default - example)
    extra = sorted(example - default)
    if extra:
        print("only in the example:", ", ".join(extra))
    if missing:
        print("missing from the example:", ", ".join(missing))
        return 1
    print(f"{len(default)} sections and keys of the default are in the example")
    return 0


if __name__ == "__main__":
    sys.exit(main())
