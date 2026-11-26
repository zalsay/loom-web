"""Generate the firmware's static phone page, or verify it with --check."""
from pathlib import Path
import json
import sys
root = Path(__file__).resolve().parent
source = (root / 'upload-form.html').read_text(encoding='utf-8')
output = root.parent / 'component/phone_form.h'
body = '/* Generated from browser/upload-form.html. */\n#pragma once\nstatic const char pad_phone_form[] =\n' + '\n'.join(json.dumps(s, ensure_ascii=False) for s in source.splitlines(keepends=True)) + ';\n'
if '--check' in sys.argv:
    if output.read_text(encoding='utf-8') != body:
        sys.exit('phone_form.h out of date; run embed-form.py')
else:
    output.write_text(body, encoding='utf-8')
