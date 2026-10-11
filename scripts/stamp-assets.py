#!/usr/bin/env python3
"""Version static module imports so a publication never mixes old and new clients."""
from pathlib import Path
import hashlib
import re

root = Path(__file__).resolve().parents[1] / 'docs'
files = sorted(p for p in root.rglob('*') if p.is_file() and p.suffix in {'.js', '.mjs', '.css', '.html', '.json'} and 'tests' not in p.parts)
def normalized(text):
    return re.sub(r'\?v=[a-zA-Z0-9_-]+', '', text)
digest = hashlib.sha256()
for path in files:
    digest.update(str(path.relative_to(root)).encode())
    digest.update(normalized(path.read_text()).encode())
version = digest.hexdigest()[:12]
for path in files:
    if path.suffix == '.json':
        continue
    text = normalized(path.read_text())
    if path.suffix in {'.js', '.mjs'}:
        text = re.sub(r'(\b(?:from|import)\s*[\'\"])(\.\.?/[^\'\"]+\.(?:js|mjs))([\'\"])', lambda m: m[1] + m[2] + '?v=' + version + m[3], text)
        text = re.sub(r'(new URL\([\'\"])(\.\.?/[^\'\"]+\.json)([\'\"])', lambda m: m[1] + m[2] + '?v=' + version + m[3], text)
    if path.suffix == '.html':
        text = re.sub(r'((?:src|href)=[\'\"])([^\'\"]+\.(?:js|css))([\'\"])', lambda m: m[1] + m[2] + '?v=' + version + m[3], text)
    if path.suffix == '.css':
        text = re.sub(r'(url\([\'\"]?)([^\'\")]+\.css)([\'\"]?\))', lambda m: m[1] + m[2] + '?v=' + version + m[3], text)
    path.write_text(text)
print('Static asset version:', version)
