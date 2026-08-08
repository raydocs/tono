"""Generate Tono Windows icon set from design-assets primary/mono masters."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
SRC_PRIMARY = ROOT / "design-assets/tono-icon/01-primary-TO-final.jpg"
SRC_MONO = ROOT / "design-assets/tono-icon/02-monochrome-TO-final.jpg"
ICONS_DIR = ROOT / "tono-win/app/src-tauri/icons"
ASSETS_DIR = ROOT / "tono-win/app/src/assets/image"
OUT_DIR = ROOT / "design-assets/tono-icon/export"


def find_content_bbox(im: Image.Image, bg_tol: int = 18) -> tuple[int, int, int, int]:
    rgb = im.convert("RGB")
    w, h = rgb.size
    corners = [
        rgb.getpixel((2, 2)),
        rgb.getpixel((w - 3, 2)),
        rgb.getpixel((2, h - 3)),
        rgb.getpixel((w - 3, h - 3)),
    ]
    br = sum(c[0] for c in corners) // 4
    bg = sum(c[1] for c in corners) // 4
    bb = sum(c[2] for c in corners) // 4
    pixels = rgb.load()
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            if abs(r - br) > bg_tol or abs(g - bg) > bg_tol or abs(b - bb) > bg_tol:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    pad = 4
    minx = max(0, minx - pad)
    miny = max(0, miny - pad)
    maxx = min(w - 1, maxx + pad)
    maxy = min(h - 1, maxy + pad)
    cx = (minx + maxx) / 2
    cy = (miny + maxy) / 2
    side = int(max(maxx - minx + 1, maxy - miny + 1) * 1.02)
    half = side / 2
    left = int(round(cx - half))
    top = int(round(cy - half))
    right = left + side
    bottom = top + side
    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > w:
        left -= right - w
        right = w
    if bottom > h:
        top -= bottom - h
        bottom = h
    return (max(0, left), max(0, top), right, bottom)


def square_on_canvas(im: Image.Image, fill: tuple[int, int, int]) -> Image.Image:
    s = max(im.size)
    canvas = Image.new("RGB", (s, s), fill)
    ox = (s - im.size[0]) // 2
    oy = (s - im.size[1]) // 2
    canvas.paste(im, (ox, oy))
    return canvas


def rounded_mask(size: int, radius_ratio: float = 0.22) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    r = int(size * radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return mask


def make_squircle_rgba(src: Image.Image, size: int, corner: float = 0.22) -> Image.Image:
    im = src.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    mask = rounded_mask(size, corner)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0))
    out.putalpha(mask)
    return out


def save_png(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, format="PNG", optimize=True)
    print(f"wrote {path} {im.size}")


def save_ico(images: list[Image.Image], path: Path) -> None:
    sizes = sorted([im.convert("RGBA") for im in images], key=lambda i: i.size[0], reverse=True)
    sizes[0].save(
        path,
        format="ICO",
        sizes=[(i.size[0], i.size[1]) for i in sizes],
        append_images=sizes[1:],
    )
    print(f"wrote {path} {[i.size for i in sizes]}")


def tray_rgba_from_mono(mono_sq: Image.Image, size: int) -> Image.Image:
    g = mono_sq.convert("L").resize((size, size), Image.Resampling.LANCZOS)
    a = g.point(lambda p: 0 if p < 20 else min(255, (p - 20) * 2))
    rgb = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    rgb.putalpha(a)
    return rgb


def tray_color_icon(prim_sq: Image.Image, size: int) -> Image.Image:
    return make_squircle_rgba(prim_sq, size, 0.22)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    prim = Image.open(SRC_PRIMARY)
    prim_sq = square_on_canvas(
        prim.crop(find_content_bbox(prim, bg_tol=22)).convert("RGB"),
        (245, 245, 247),
    )
    prim_sq.save(OUT_DIR / "primary-square.png")

    mono = Image.open(SRC_MONO)
    mono_sq = square_on_canvas(
        mono.crop(find_content_bbox(mono, bg_tol=28)).convert("RGB"),
        (0, 0, 0),
    )
    mono_sq.save(OUT_DIR / "mono-square.png")

    master = prim_sq.resize((1024, 1024), Image.Resampling.LANCZOS)
    master.save(OUT_DIR / "windows-icon-master-1024.png")
    make_squircle_rgba(prim_sq, 1024, 0.223).save(OUT_DIR / "icon-1024-mask.png")

    sizes_png = {
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
    for name, size in sizes_png.items():
        save_png(prim_sq.resize((size, size), Image.Resampling.LANCZOS), ICONS_DIR / name)

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_imgs = [prim_sq.resize((n, n), Image.Resampling.LANCZOS) for n in ico_sizes]
    save_ico(ico_imgs, ICONS_DIR / "icon.ico")
    save_ico(ico_imgs, ASSETS_DIR / "logo.ico")

    save_png(prim_sq.resize((256, 256), Image.Resampling.LANCZOS), ASSETS_DIR / "logo.png")
    save_png(make_squircle_rgba(prim_sq, 256, 0.223), ASSETS_DIR / "logo-mask.png")

    tray_names_color = ["tray-icon.ico", "tray-icon-sys.ico", "tray-icon-tun.ico"]
    tray_names_mono = [
        "tray-icon-mono.ico",
        "tray-icon-sys-mono.ico",
        "tray-icon-sys-mono-new.ico",
        "tray-icon-tun-mono.ico",
        "tray-icon-tun-mono-new.ico",
    ]
    tray_sizes = (16, 20, 24, 32, 40, 48, 64)
    for name in tray_names_color:
        save_ico([tray_color_icon(prim_sq, n) for n in tray_sizes], ICONS_DIR / name)
    for name in tray_names_mono:
        save_ico([tray_rgba_from_mono(mono_sq, n) for n in tray_sizes], ICONS_DIR / name)

    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <defs>
    <linearGradient id="g" x1="20" y1="24" x2="110" y2="104" gradientUnits="userSpaceOnUse">
      <stop stop-color="#3B5BFF"/>
      <stop offset="0.45" stop-color="#7B5CFF"/>
      <stop offset="0.78" stop-color="#C58BFF"/>
      <stop offset="1" stop-color="#FFB07A"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="#F6F3EC"/>
  <path d="M28 36h40c6 0 10 4 10 10v10H56c-4 0-7 3-7 7v39H28V36z" fill="url(#g)"/>
  <ellipse cx="82" cy="70" rx="30" ry="34" stroke="url(#g)" stroke-width="9" fill="none"/>
  <ellipse cx="82" cy="70" rx="18" ry="21" stroke="url(#g)" stroke-width="7" fill="none" opacity="0.85"/>
  <ellipse cx="82" cy="70" rx="8" ry="10" stroke="url(#g)" stroke-width="5" fill="none" opacity="0.7"/>
</svg>
"""
    (ASSETS_DIR / "logo.svg").write_text(svg, encoding="utf-8")
    print("wrote logo.svg")
    print("DONE")


if __name__ == "__main__":
    main()
