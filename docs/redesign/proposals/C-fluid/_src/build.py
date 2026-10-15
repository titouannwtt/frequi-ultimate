#!/usr/bin/env python3
"""Assemble les maquettes autonomes : inline base.css et core.js dans chaque page de _src."""
import pathlib, sys
src = pathlib.Path(__file__).resolve().parent
out = src.parent
css = (src / 'base.css').read_text()
js = (src / 'core.js').read_text()
pages = sys.argv[1:] or [p.name for p in src.glob('*.html')]
for name in pages:
    html = (src / name).read_text()
    html = html.replace('/*@CSS*/', css).replace('/*@CORE*/', js)
    assert '\u2014' not in html, f'tiret cadratin interdit dans {name}'
    (out / name).write_text(html)
    print('ok', out / name)
