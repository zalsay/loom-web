#!/usr/bin/env python3
"""Write local, private provisioning inputs. Never access a serial port or network."""
import argparse
import csv
from pathlib import Path
import secrets

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('new_private_dir', type=Path)
for value in ['min', 'center', 'max']:
    p.add_argument('--' + value, type=int, required=True, help='Measured raw zero-trim servo angle (degrees)')
a = p.parse_args()
if not 45 <= a.min < a.center < a.max <= 180 or a.max - a.min > 28:
    p.error('Require measured 45 <= min < center < max <= 180, span <= 28')
a.new_private_dir.mkdir(mode=0o700, exist_ok=False)
key = secrets.token_hex(32)
with (a.new_private_dir / 'direct.csv').open('x', newline='', encoding='ascii') as f:
    csv.writer(f, lineterminator='\n').writerows([
        ['key', 'type', 'encoding', 'value'], ['duck_direct','namespace','',''],
        ['key','data','string',key], ['min_deg','data','u8',a.min],
        ['center_deg','data','u8',a.center], ['max_deg','data','u8',a.max]])
with (a.new_private_dir / 'device-key').open('x', encoding='ascii') as f:
    f.write(key + '\n')
print('Generated direct.csv and device-key in the new private directory; do not share or commit them.')
