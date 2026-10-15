#!/usr/bin/env python3
"""Assemble les maquettes autonomes : injecte base.css et core.js dans chaque page de _src/pages.
Refuse le tiret cadratin (U+2014) partout."""
import pathlib, sys
src = pathlib.Path(__file__).resolve().parent
out = src.parent
css = (src / 'base.css').read_text()
js = (src / 'core.js').read_text()
head = (src / 'head.html').read_text()
for f in (src / 'base.css', src / 'core.js', src / 'head.html'):
    assert '\u2014' not in f.read_text(), f'tiret cadratin interdit dans {f.name}'
pages = sys.argv[1:] or sorted(p.name for p in (src / 'pages').glob('*.html'))
for name in pages:
    html = (src / 'pages' / name).read_text()
    html = html.replace('<!--@HEAD-->', head).replace('/*@CSS*/', css).replace('/*@CORE*/', js)
    assert '\u2014' not in html, f'tiret cadratin interdit dans {name}'
    (out / name).write_text(html)
    print('ok', name, len(html) // 1024, 'Ko')
