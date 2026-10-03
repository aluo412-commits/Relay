#!/usr/bin/env python3
"""Reproducible, allow-listed unpacked-extension download. No dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
files = ['manifest.json', 'background.js', 'capture.js', 'popup.html', 'popup.js', 'popup.css', 'README.md']
out = root / 'public/downloads/relay-course-reader.zip'
out.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(out, 'w') as archive:
    for name in files:
        info = ZipInfo('relay-course-reader/' + name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (root / 'extensions/course-reader' / name).read_bytes())
print(out)
