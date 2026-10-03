"""Bake deterministic ripple masks and grain; Python stdlib, no live SVG filter."""
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
            for y in range(max(0, math.floor(center - half - feather)),
                           min(270, math.ceil(center + half + feather))):
                coverage = max(0, min(1, (half + feather - abs(y + .5 - center)) / feather))
                rows[y][x] = max(rows[y][x], round(255 * coverage * density))
    png(f"ripple-{layer + 1}.png", 920, 270, rows)

rng = random.Random(7)
png("grain.png", 220, 220,
    [bytes(value for _ in range(220) for value in (255, 255, 255, rng.randrange(48, 93)))
     for _ in range(220)], color_type=6)
