"""Draw Tono's iOS brand assets from the approved sun-on-the-horizon artwork.

Same source as the desktop apps (decision 095, owner-approved 2026-10-12): the geometry comes from
`apps/windows/app/scripts/generate-tono-icons.py` (`draw_tile`, `draw_mark`), which draws
`apps/windows/app/src/dev/sea-shell/brand/icons/tono-256.svg` and `mark.svg`. Only the platform
adaptation differs:

- AppIcon: the tile filled to its corners, opaque, 1024 px (iOS applies its own squircle mask and
  rejects alpha in the marketing icon).
- TonoMark: the mark (half sun and two reflections, no tile) for the in-app top bar and sign-in.
- LaunchMark: the same mark, centred on the splash ground by the launch screen.

    python3 apps/ios/tools/generate-ios-brand.py      # install design-assets/tono-icon/requirements.txt first
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DESKTOP = REPO_ROOT / "apps/windows/app/scripts/generate-tono-icons.py"
ASSETS = REPO_ROOT / "apps/ios/App/Resources/Assets.xcassets"

spec = importlib.util.spec_from_file_location("tono_icons", DESKTOP)
icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)


def save(image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)
    print(f"wrote {path.relative_to(REPO_ROOT)} {image.size}")


def image_set(name: str, base: str, master, points: int) -> None:
    folder = ASSETS / f"{name}.imageset"
    images = []
    for scale in (1, 2, 3):
        filename = f"{base}@{scale}x.png"
        save(icons.resize_rgba(master, points * scale), folder / filename)
        images.append({"filename": filename, "idiom": "universal", "scale": f"{scale}x"})
    contents = {"images": images, "info": {"author": "xcode", "version": 1}}
    (folder / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")


def main() -> None:
    tile = icons.draw_tile(rounded=False)
    mark = icons.draw_mark()
    save(icons.resize_rgba(tile, 1024).convert("RGB"), ASSETS / "AppIcon.appiconset/AppIcon-1024.png")
    image_set("TonoMark", "tono-mark", mark, 44)
    image_set("LaunchMark", "launch-mark", mark, 64)


if __name__ == "__main__":
    main()
