"""Generate Tono's clean, transparent Windows icon set.

The checked-in RGBA master contains only the TO glyph: no tile, outer frame,
bevel, or drop shadow. Run this file from any working directory; all paths are
resolved relative to the monorepo root.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[4]
SRC_MASTER = REPO_ROOT / "design-assets/tono-icon/03-clean-TO-transparent.png"
APP_DIR = REPO_ROOT / "apps/windows/app"
ICONS_DIR = APP_DIR / "src-tauri/icons"
ASSETS_DIR = APP_DIR / "src/assets/image"
OUT_DIR = REPO_ROOT / "design-assets/tono-icon/export"

MAIN_ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
# 16/20/24 should come from the optical SVG (tono-mark-16-color.svg) once
# design signs that reconstruction off. Until then keep the raster master —
# the concentric counter collapses on the pixel grid below ~28px.
TRAY_ICO_SIZES = (16, 20, 24, 32, 40, 48, 64)


def load_master() -> Image.Image:
    master = Image.open(SRC_MASTER).convert("RGBA")
    if master.size != (1024, 1024):
        raise ValueError(f"transparent icon master must be 1024x1024, got {master.size}")

    alpha = master.getchannel("A")
    if alpha.getextrema() != (0, 255):
        raise ValueError("transparent icon master must contain transparent and opaque pixels")

    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("transparent icon master has no visible glyph")
    left, top, right, bottom = bbox
    if min(left, top, 1024 - right, 1024 - bottom) < 48:
        raise ValueError(f"transparent icon master needs at least 48px safety margin, got {bbox}")

    for point in ((0, 0), (1023, 0), (0, 1023), (1023, 1023)):
        if master.getpixel(point)[3] != 0:
            raise ValueError(f"transparent icon master corner is not transparent: {point}")

    # A green-screen extraction was used while developing the artwork. Green is not part of this
    # mark's palette, so reject spill anywhere in the visible glyph before it reaches the taskbar.
    spill = 0
    for red, green, blue, opacity in master.get_flattened_data():
        if opacity > 0 and green > max(red, blue) + 5:
            spill += 1
    if spill:
        raise ValueError(f"transparent icon master contains {spill} green-spill pixels")

    return master


def resize_rgba(image: Image.Image, size: int) -> Image.Image:
    """Resize in premultiplied-alpha space so transparent edges never gain a halo."""

    resized = (
        image.convert("RGBa")
        .resize((size, size), Image.Resampling.LANCZOS)
        .convert("RGBA")
    )
    pixels = bytearray(resized.tobytes())
    for offset in range(0, len(pixels), 4):
        opacity = pixels[offset + 3]
        if opacity < 4:
            pixels[offset : offset + 4] = b"\0\0\0\0"
            continue
        red, green, blue = pixels[offset : offset + 3]
        green_ceiling = min(255, max(red, blue) + 5)
        if green > green_ceiling:
            pixels[offset + 1] = green_ceiling
    return Image.frombytes("RGBA", resized.size, bytes(pixels))


def monochrome_icon(master: Image.Image, size: int) -> Image.Image:
    alpha = resize_rgba(master, size).getchannel("A")
    output = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    output.putalpha(alpha)
    return output


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)
    print(f"wrote {path} {image.size}")


def save_ico(images: list[Image.Image], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(
        [image.convert("RGBA") for image in images],
        key=lambda image: image.size[0],
        reverse=True,
    )
    ordered[0].save(
        path,
        format="ICO",
        sizes=[image.size for image in ordered],
        append_images=ordered[1:],
    )
    print(f"wrote {path} {[image.size for image in ordered]}")


def write_clean_svg() -> None:
    # This vector companion is used by web surfaces. The cutout masks the complete union so the
    # centre of the O stays transparent even where the T passes behind it.
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <defs>
    <linearGradient id="tono-gradient" x1="12" y1="18" x2="116" y2="112" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1433D5"/>
      <stop offset="0.38" stop-color="#583EDE"/>
      <stop offset="0.68" stop-color="#D553CA"/>
      <stop offset="1" stop-color="#FFB26F"/>
    </linearGradient>
    <mask id="tono-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
      <rect width="128" height="128" fill="white"/>
      <ellipse cx="86" cy="67" rx="10" ry="21" fill="black"/>
    </mask>
  </defs>
  <g mask="url(#tono-cutout)">
    <path d="M18 16h66v24H67v65c0 8-5 12-12 12h-2c-7 0-12-4-12-12V40H18C11 40 6 35 6 28s5-12 12-12z" fill="url(#tono-gradient)"/>
    <ellipse cx="86" cy="67" rx="36" ry="51" fill="url(#tono-gradient)"/>
    <ellipse cx="86" cy="67" rx="29" ry="43" stroke="#3447DE" stroke-opacity="0.52" stroke-width="5"/>
    <ellipse cx="86" cy="67" rx="22" ry="34" stroke="#F47DAF" stroke-opacity="0.48" stroke-width="5"/>
    <ellipse cx="86" cy="67" rx="15" ry="26" stroke="#7049D9" stroke-opacity="0.48" stroke-width="4"/>
  </g>
</svg>
"""
    path = ASSETS_DIR / "logo.svg"
    path.write_text(svg, encoding="utf-8")
    print(f"wrote {path}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    master = load_master()
    mono_master = Image.new("RGBA", master.size, (255, 255, 255, 0))
    mono_master.putalpha(master.getchannel("A"))

    save_png(master, OUT_DIR / "windows-icon-master-1024.png")
    save_png(master, OUT_DIR / "primary-square.png")
    save_png(mono_master, OUT_DIR / "mono-square.png")
    save_png(master, OUT_DIR / "icon-1024-mask.png")

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
        save_png(resize_rgba(master, size), ICONS_DIR / name)

    main_ico_images = [resize_rgba(master, size) for size in MAIN_ICO_SIZES]
    save_ico(main_ico_images, ICONS_DIR / "icon.ico")
    save_ico(main_ico_images, ASSETS_DIR / "logo.ico")

    save_png(resize_rgba(master, 256), ASSETS_DIR / "logo.png")
    save_png(resize_rgba(master, 256), ASSETS_DIR / "logo-mask.png")

    color_tray_names = ("tray-icon.ico", "tray-icon-sys.ico", "tray-icon-tun.ico")
    mono_tray_names = (
        "tray-icon-mono.ico",
        "tray-icon-sys-mono.ico",
        "tray-icon-sys-mono-new.ico",
        "tray-icon-tun-mono.ico",
        "tray-icon-tun-mono-new.ico",
    )
    color_tray_images = [resize_rgba(master, size) for size in TRAY_ICO_SIZES]
    mono_tray_images = [monochrome_icon(master, size) for size in TRAY_ICO_SIZES]
    for name in color_tray_names:
        save_ico(color_tray_images, ICONS_DIR / name)
    for name in mono_tray_names:
        save_ico(mono_tray_images, ICONS_DIR / name)

    write_clean_svg()
    print("DONE")


if __name__ == "__main__":
    main()
