#!/usr/bin/env python3
"""Install this overlay into a separate checkout of the regular (not Plus) firmware."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

PIN = 'd12f481f4a42420634bb56a928f3959a977367d4'
HERE = Path(__file__).resolve().parent
FILES = ('CMakeLists.txt', 'include/pad_share.h', 'pad_share.c', 'snapshot.c', 'snapshot.h',
         'upload.c', 'upload.h', 'phone_form.h', 'library.c', 'library.h')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('firmware', type=Path)
    parser.add_argument('--check', action='store_true', help='validate without writing')
    args = parser.parse_args()
    root = args.firmware.resolve(strict=True)
    env = os.environ.copy()
    if env.get('GIT_CONFIG_COUNT') and not env.get('GIT_CONFIG_KEY_0'):
        env.pop('GIT_CONFIG_COUNT')

    def git(*argv):
        return subprocess.check_output(['git', '-C', str(root), *argv], env=env, text=True).strip()

    if Path(git('rev-parse', '--show-toplevel')).resolve() != root or git('rev-parse', 'HEAD') != PIN:
        sys.exit(f'Refusing: pass a firmware checkout root at {PIN}')
    dest = root / 'components' / 'pad_share'
    if dest.parent.resolve() != root / 'components' or os.path.lexists(dest):
        sys.exit('Refusing: component destination is redirected or already exists')
    patch = str(HERE / 'card-share.patch')
    src = HERE.parent / 'component'
    for name in FILES:
        if not (src / name).is_file():
            sys.exit(f'Missing component source: {name}')
    git('apply', '--check', patch)
    if args.check:
        print('OK: pinned revision, component sources, destination and patch contexts checked')
        return
    dest.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent, prefix='.pad-share-') as scratch:
        staged = Path(scratch) / 'pad_share'
        for name in FILES:
            out = staged / name
            out.parent.mkdir(exist_ok=True, parents=True)
            shutil.copyfile(src / name, out)
        git('apply', patch)
        staged.rename(dest)
    print('Installed: 设置 → 存储 → 分享本项目卡片列表 / 分享当前项目卡 / 从手机加照片')


if __name__ == '__main__':
    main()
