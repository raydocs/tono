"""Bake deterministic sea masks, soft clouds and grain; Python stdlib, no live SVG filter."""
from pathlib import Path
import math
import random
import struct
import zlib

DEST = Path(__file__).resolve().parents[1] / "src/tono-ui/sea-assets"
BANDS = (
    ((.7, 1), (7.2, 7.9), (13.8, 15.1), (21.4, 22), (29.9, 33.1),
     (43.2, 44.9), (53.1, 55.3), (64, 67.6), (81.1, 85.9), (99.5, 107.9),
     (128.3, 134.5), (149.3, 159.8), (182.9, 197.2), (217.7, 234.1), (267.2, 269.3)),
    ((3.6, 4.7), (10.7, 11), (18.2, 18.8), (25.4, 27.6), (37, 39.7),
     (47.5, 50.5), (58.5, 60.3), (72.3, 76.7), (90.6, 95.7), (114.1, 122.6),
     (138.9, 145.4), (165.1, 177.3), (205.3, 212.2), (241.2, 260.1)),
)


def png(name, width, height, rows, color_type=0):
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data +
                struct.pack(">I", zlib.crc32(kind + data)))
    payload = b"\x89PNG\r\n\x1a\n"
    payload += chunk(b"IHDR", struct.pack(">2I5B", width, height, 8, color_type, 0, 0, 0))
    payload += chunk(b"IDAT", zlib.compress(b"".join(b"\0" + row for row in rows), 9))
    payload += chunk(b"IEND", b"")
    (DEST / name).write_bytes(payload)
    print(f"{name}: {width}x{height}, {len(payload)} bytes")


DEST.mkdir(parents=True, exist_ok=True)
for layer, bands in enumerate(BANDS):
    rows = [bytearray(920) for _ in range(270)]
    rng = random.Random(17 + layer)
    for lo, hi in bands:
        middle = (lo + hi) / 2
        depth = min(middle / 150, 1)
        phase = rng.uniform(0, math.tau)
        wavelength = rng.uniform(28, 58) * (.65 + depth * .75)
        feather = .65 + depth * 1.15
        for x in range(920):
            # Distant ribbons stay fine; nearer folds bend, taper and break up.
            bend = ((.35 + depth * 5.5) * math.sin(x / 42 + phase) +
                    (.15 + depth * 1.5) * math.sin(x / 15 - phase))
            scallop = (.5 + .3 * math.sin(x / wavelength + phase) +
                       .2 * math.sin(x / (wavelength * .43) - phase))
            half = (hi - lo) / 2 * (1 - depth * .75 * (1 - scallop))
            density = 1 - depth * (.12 + .75 * (1 - scallop))
            center = middle + bend
            for y in range(math.floor(center - half - feather),
                           math.ceil(center + half + feather)):
                coverage = max(0, min(1, (half + feather - abs(y + .5 - center)) / feather))
                rows[y % 270][x] = max(rows[y % 270][x], round(255 * coverage * density))
    png(f"ripple-{layer + 1}.png", 920, 270, rows)

rng = random.Random(7)
png("grain.png", 220, 220,
    [bytes(value for _ in range(220) for value in (255, 255, 255, rng.randrange(48, 93)))
     for _ in range(220)], color_type=6)


# Two periodic, subpixel-soft highlight fields, not a stack of rounded bars.
for layer in range(2):
    width, height = 512, 192
    rows = [bytearray(width) for _ in range(height)]
    rng = random.Random(51 + layer)
    for _ in range(480):
        cx, cy = rng.uniform(0, width), rng.uniform(0, height)
        rx, ry = rng.uniform(1.5, 9), rng.uniform(.45, 1.25)
        intensity = rng.uniform(.18, .9)
        for y in range(math.floor(cy - ry * 2), math.ceil(cy + ry * 2)):
            for x in range(math.floor(cx - rx * 2), math.ceil(cx + rx * 2)):
                value = round(255 * intensity * math.exp(
                    -2 * (((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2)))
                rows[y % height][x % width] = max(rows[y % height][x % width], value)
    png(f"specks-{layer + 1}.png", width, height, rows)

# Fixed perspective/edge envelope. The specks move behind this, not the wedge.
rows = []
for y in range(270):
    depth = y / 269
    half = 7 + 143 * depth ** .72
    fade = (1 - depth) ** .8
    rows.append(bytes(round(255 * max(0, 1 - (abs(x + .5 - 150) / half) ** 3)
                            * fade) for x in range(300)))
png("path-envelope.png", 300, 270, rows)

# Clouds are prepainted RGBA: lumpy feathered bodies and a restrained warm underside.
for layer in range(2):
    width, height = 768, 128
    rng = random.Random(91 + layer)
    phases = [rng.uniform(0, math.tau) for _ in range(4)]
    rows = [bytearray() for _ in range(height)]
    for y in range(height):
        for x in range(width):
            u = x / width
            edge = math.sin(math.pi * u) ** 1.5
            center = 57 + 10 * math.sin(x / 93 + phases[0]) + 5 * math.sin(x / 37 + phases[1])
            radius = 12 + 7 * math.sin(x / 71 + phases[2]) + 3 * math.sin(x / 19 + phases[3])
            body = math.exp(-1.4 * ((y - center) / radius) ** 2) * edge * (.5 + .5 * math.sin(x / 83 + phases[2]) ** 2)
            rim = math.exp(-2 * ((y - center - radius * .6) / 4) ** 2) * edge * .04
            alpha = min(.55, body * .24 + rim)
            warm = rim / max(body * .24 + rim, .001)
            rows[y].extend((round(14 + 241 * warm), round(6 + 144 * warm),
                            round(10 + 74 * warm), round(255 * alpha)))
    png(f"cloud-{layer + 1}.png", width, height, rows, color_type=6)


# Periodic broad sea folds. Counter-drifting planes reveal the whole surface.
for layer in range(2):
    width, height = 920, 180
    rng = random.Random(123 + layer)
    rows = [bytearray(width) for _ in range(height)]
    for band in range(15):
        phase = rng.uniform(0, math.tau)
        jitter = rng.uniform(-3, 3)
        for x in range(width):
            center = jitter + band * 12 + 3.5 * math.sin(x / 110 + phase) + 1.2 * math.sin(x / 39 - phase)
            strength = .35 + .65 * (.5 + .5 * math.sin(x / 167 + phase))
            for y in range(math.floor(center - 4), math.ceil(center + 4)):
                value = round(255 * strength * math.exp(-.65 * (y + .5 - center) ** 2))
                rows[y % height][x] = max(rows[y % height][x], value)
    png(f"swell-{layer + 1}.png", width, height, rows)


# Stationary reflection envelope: 32px side feather, shorter broken bands nearby.
rows = []
for y in range(270):
    depth = y / 269
    half = 116 - 58 * depth ** .7
    fade = (1 - depth) ** 1.5
    row = []
    for x in range(330):
        distance = abs(x + .5 - 165)
        edge = max(0, min(1, (half - distance) / 32))
        edge = edge * edge * (3 - 2 * edge)
        gaps = (.5 + .5 * math.sin(x / (19 - 10 * depth) + y / 7)) ** 2
        fragments = 1 - depth * .85 * gaps
        row.append(round(255 * edge * fade * fragments))
    rows.append(bytes(row))
png("reflection-envelope.png", 330, 270, rows)
