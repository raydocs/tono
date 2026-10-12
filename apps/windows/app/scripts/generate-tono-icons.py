"""Generate Tono's sun-on-the-horizon icon set for Windows and macOS.

The artwork is the approved brand sheet in `src/dev/sea-shell/brand/` (owner, 2026-10-12):
a dark indigo tile with a warm half sun and three horizon reflections. The hand-tuned
pixel-aligned rasters there (`icons/tono-{16,24,32,48,64,128,256}.png`) are used as they are
for those sizes; every other size is drawn here from the same geometry as `icons/tono-256.svg`,
supersampled, so no browser or font is needed and the output is reproducible.

Run from any working directory; paths resolve from the monorepo root:

    python3 apps/windows/app/scripts/generate-tono-icons.py
"""

from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

REPO_ROOT = Path(__file__).resolve().parents[4]
APP_DIR = REPO_ROOT / "apps/windows/app"
BRAND_DIR = APP_DIR / "src/dev/sea-shell/brand"
ICONS_DIR = APP_DIR / "src-tauri/icons"
ASSETS_DIR = APP_DIR / "src/assets"
MAC_ASSETS = REPO_ROOT / "apps/macos/Tono/Assets.xcassets"

TUNED_SIZES = (16, 24, 32, 48, 64, 128, 256)
MAIN_ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
TRAY_ICO_SIZES = (16, 20, 24, 32, 40, 48, 64)

GROUND = ((0x15, 0x16, 0x2E), (0x24, 0x26, 0x4B))
SUN = ((0xFF, 0xF0, 0xD2), (0xFF, 0xAD, 0x74))
SUPERSAMPLE = 4096  # drawing canvas; 16x the 256 viewBox


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    column = Image.new("RGB", (1, height))
    for y in range(height):
        t = y / max(1, height - 1)
        column.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return column.resize((width, height))


def paint(canvas: Image.Image, mask: Image.Image, box: tuple[int, int, int, int], colors) -> None:
    """Fill `mask` with a vertical gradient spanning `box` (SVG objectBoundingBox)."""

    left, top, right, bottom = box
    fill = Image.new("RGB", canvas.size)
    fill.paste(vertical_gradient((right - left, bottom - top), *colors), (left, top))
    canvas.paste(fill, (0, 0), mask)


def draw_tile(rounded: bool = True) -> Image.Image:
    """`icons/tono-256.svg` at SUPERSAMPLE px. `rounded=False` fills the square to its corners."""

    k = SUPERSAMPLE / 256
    canvas = Image.new("RGBA", (SUPERSAMPLE, SUPERSAMPLE), (0, 0, 0, 0))

    def mask_of(shape) -> Image.Image:
        mask = Image.new("L", canvas.size, 0)
        shape(ImageDraw.Draw(mask))
        return mask

    ground = mask_of(
        lambda d: d.rounded_rectangle((0, 0, SUPERSAMPLE - 1, SUPERSAMPLE - 1), radius=round(59 * k) if rounded else 0, fill=255)
    )
    paint(canvas, ground, (0, 0, SUPERSAMPLE, SUPERSAMPLE), GROUND)

    # M64 131 a64 64 0 0 1 128 0 Z: the upper half disc, centre (128, 131), r 64.
    sun = mask_of(lambda d: d.pieslice((64 * k, 67 * k, 192 * k, 195 * k), 180, 360, fill=255))
    paint(canvas, sun, (round(64 * k), round(67 * k), round(192 * k), round(131 * k)), SUN)

    for x, y, w in ((30, 141, 195), (73, 153, 110), (102, 165, 51)):
        box = (round(x * k), round(y * k), round((x + w) * k), round((y + 4) * k))
        bar = mask_of(lambda d, b=box: d.rounded_rectangle(b, radius=round(2 * k), fill=255))
        paint(canvas, bar, box, SUN)
    return canvas


def draw_mark() -> Image.Image:
    """`mark.svg` (sun and two reflections, no tile) at SUPERSAMPLE px."""

    k = SUPERSAMPLE / 32
    canvas = Image.new("RGBA", (SUPERSAMPLE, SUPERSAMPLE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.pieslice((6 * k, 7 * k, 26 * k, 27 * k), 180, 360, fill=(0xFF, 0xD5, 0x8E, 255))
    draw.rounded_rectangle((2 * k, 19 * k, 30 * k, 21 * k), radius=k, fill=(0xFF, 0xB8, 0x77, 255))
    draw.rounded_rectangle((9 * k, 24 * k, 23 * k, 25.5 * k), radius=0.75 * k, fill=(0xFF, 0xB8, 0x77, 255))
    return canvas


def resize_rgba(image: Image.Image, size: int) -> Image.Image:
    """Resize in premultiplied-alpha space so transparent edges never gain a halo."""

    return image.convert("RGBa").resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")


def tuned_or_drawn(master: Image.Image, size: int) -> Image.Image:
    if size in TUNED_SIZES:
        return Image.open(BRAND_DIR / f"icons/tono-{size}.png").convert("RGBA")
    return resize_rgba(master, size)


def mac_icon(tile: Image.Image) -> Image.Image:
    """macOS app-icon grid: an 824/1024 body centred on a transparent canvas with a soft shadow."""

    side, body = 1024, 824
    offset = (side - body) // 2
    shape = resize_rgba(tile, body)
    shadow = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    alpha = Image.new("L", (side, side), 0)
    alpha.paste(shape.getchannel("A"), (offset, offset + 10))
    shadow.putalpha(alpha.point(lambda a: a * 0.3).filter(ImageFilter.GaussianBlur(10)))
    canvas = Image.alpha_composite(Image.new("RGBA", (side, side), (0, 0, 0, 0)), shadow)
    canvas.alpha_composite(shape, (offset, offset))
    return canvas


def with_status_dot(image: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    """Corner status pip so 16px tray states stay distinct on light and dark taskbars."""

    output = image.copy()
    draw = ImageDraw.Draw(output)
    size = output.size[0]
    radius = max(3, round(size * 0.15))
    margin = max(1, round(size * 0.07))
    x2 = size - margin
    y2 = size - margin
    x1 = x2 - radius * 2
    y1 = y2 - radius * 2
    draw.ellipse((x1 - 1, y1 - 1, x2 + 1, y2 + 1), fill=(20, 22, 30, 220))
    draw.ellipse((x1, y1, x2, y2), fill=(255, 255, 255, 235))
    inset = max(1, round(radius * 0.28))
    draw.ellipse((x1 + inset, y1 + inset, x2 - inset, y2 - inset), fill=(*rgb, 255))
    return output


def monochrome(image: Image.Image) -> Image.Image:
    output = Image.new("RGBA", image.size, (255, 255, 255, 0))
    output.putalpha(image.getchannel("A"))
    return output


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)
    print(f"wrote {path.relative_to(REPO_ROOT)} {image.size}")


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def save_ico(entries: list[tuple[int, bytes]], path: Path) -> None:
    """Pack PNG entries into an ICO without re-encoding, so the tuned rasters ship byte for byte."""

    entries = sorted(entries, key=lambda entry: entry[0])
    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = len(header) + 16 * len(entries)
    directory, blobs = b"", b""
    for size, data in entries:
        directory += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    path.write_bytes(header + directory + blobs)
    print(f"wrote {path.relative_to(REPO_ROOT)} {[size for size, _ in entries]}")


def ico_entry(master: Image.Image, size: int) -> tuple[int, bytes]:
    if size in TUNED_SIZES:
        return size, (BRAND_DIR / f"icons/tono-{size}.png").read_bytes()
    return size, png_bytes(resize_rgba(master, size))


def main() -> None:
    tile = draw_tile()
    mark = draw_mark()

    # Windows bundle icons (tauri.conf.json `bundle.icon`, the NSIS installer icon, Store tiles).
    png_sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, size in png_sizes.items():
        save_png(tuned_or_drawn(tile, size), ICONS_DIR / name)
    main_ico = [ico_entry(tile, size) for size in MAIN_ICO_SIZES]
    save_ico(main_ico, ICONS_DIR / "icon.ico")
    save_ico(main_ico, ASSETS_DIR / "image/logo.ico")
    mac_master = mac_icon(tile)
    mac_master.save(ICONS_DIR / "icon.icns", format="ICNS")
    print("wrote icon.icns")

    # Tray: the tile with the existing state pip (grey idle, amber system proxy, green TUN).
    for name, rgb in {
        "tray-icon.ico": (142, 142, 147),
        "tray-icon-sys.ico": (255, 159, 10),
        "tray-icon-tun.ico": (46, 213, 115),
    }.items():
        save_ico(
            [(size, png_bytes(with_status_dot(tuned_or_drawn(tile, size), rgb))) for size in TRAY_ICO_SIZES],
            ICONS_DIR / name,
        )
    # macOS-only template variants of the Windows app's tray (not in the Windows package).
    mono_tray = [(size, png_bytes(monochrome(resize_rgba(mark, size)))) for size in TRAY_ICO_SIZES]
    for name in (
        "tray-icon-mono.ico",
        "tray-icon-sys-mono.ico",
        "tray-icon-sys-mono-new.ico",
        "tray-icon-tun-mono.ico",
        "tray-icon-tun-mono-new.ico",
    ):
        save_ico(mono_tray, ICONS_DIR / name)

    # NSIS Modern UI bitmaps, copied from the approved sheet (24-bit BMP, 150x57 and 164x314).
    for name in ("installer-header.bmp", "installer-sidebar.bmp"):
        (ICONS_DIR / name).write_bytes((BRAND_DIR / name).read_bytes())
        print(f"wrote {(ICONS_DIR / name).relative_to(REPO_ROOT)}")

    # Welcome hero: the tile filled to its corners; the component clips it to a 22% radius.
    save_png(resize_rgba(draw_tile(rounded=False), 512).convert("RGB"), ASSETS_DIR / "welcome-hero.png")

    # macOS app icon, in-app mark and welcome hero.
    for size in (16, 32, 128, 256, 512):
        save_png(resize_rgba(mac_master, size), MAC_ASSETS / f"AppIcon.appiconset/icon_{size}x{size}.png")
        save_png(resize_rgba(mac_master, size * 2), MAC_ASSETS / f"AppIcon.appiconset/icon_{size}x{size}@2x.png")
    save_png(resize_rgba(tile, 1024), MAC_ASSETS / "TonoMark.imageset/tono-mark.png")
    save_png(resize_rgba(mark, 16), MAC_ASSETS / "MenuBarIcon.imageset/icon_16x16.png")
    save_png(resize_rgba(mark, 32), MAC_ASSETS / "MenuBarIcon.imageset/icon_16x16@2x.png")
    save_png(resize_rgba(draw_tile(rounded=False), 1024).convert("RGB"), MAC_ASSETS / "WelcomeHero.imageset/welcome-hero-1024.png")
    print("DONE")


if __name__ == "__main__":
    main()
