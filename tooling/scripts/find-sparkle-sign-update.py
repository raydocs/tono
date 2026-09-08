#!/usr/bin/env python3
"""Select exactly one modern Sparkle signer, never the legacy DSA script."""
import argparse
from pathlib import Path
import stat


def find_signer(artifacts: Path) -> Path:
    # Sparkle also ships bin/old_dsa_scripts/sign_update. A recursive basename
    # search picks that obsolete tool depending on directory traversal order.
    candidates = sorted(
        path for path in artifacts.glob('**/bin/sign_update')
        if path.is_file() and path.stat().st_mode & stat.S_IXUSR
    )
    if len(candidates) != 1:
        raise ValueError(f'expected exactly one executable modern Sparkle bin/sign_update, found {len(candidates)} under {artifacts}')
    return candidates[0].resolve()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifacts', type=Path)
    args = parser.parse_args()
    try:
        print(find_signer(args.artifacts))
    except ValueError as error:
        parser.exit(1, f'{error}\n')
