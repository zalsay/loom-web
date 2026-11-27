#!/usr/bin/env python3
"""Host-only C tests and offline checks; no socket, USB or serial access."""
import csv
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as temp:
    tmp = Path(temp)
    exe = tmp / 'test-control'
    subprocess.run([os.getenv('CC', 'cc'), '-std=c11','-Wall','-Wextra','-Werror','-Isrc',
                    'src/control.c','tests/control_test.c','-o',str(exe)], cwd=root, check=True)
    subprocess.run([exe], check=True)
    private = tmp / 'private'
    tool = [sys.executable, str(root / 'make-provisioning.py'), str(private)]
    for limits in [(44,50,60), (80,90,109), (80,80,82)]:
        lo,mid,hi = map(str,limits)
        p=subprocess.run(tool+['--min',lo,'--center',mid,'--max',hi], capture_output=True)
        assert p.returncode != 0 and not private.exists()
    valid=tool+['--min','80','--center','90','--max','100']
    subprocess.run(valid,check=True,stdout=subprocess.DEVNULL)
    key = (private / 'device-key').read_text().strip()
    assert re.fullmatch(r'[a-f0-9]{64}',key) and (private.stat().st_mode & 0o077) == 0
    with (private / 'direct.csv').open() as f: rows = list(csv.reader(f))
    assert rows[1:] == [['duck_direct','namespace','',''],['key','data','string',key],
                        ['min_deg','data','u8','80'],['center_deg','data','u8','90'],['max_deg','data','u8','100']]
    assert subprocess.run(valid,capture_output=True).returncode != 0
    assert (private / 'device-key').read_text().strip() == key
print('PASS: offline provisioning bounds, key format, private directory and no overwrite')
