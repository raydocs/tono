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
    rows = []
    for y in range(270):
        row = bytearray()
        for x in range(920):
            # Baked cross-wave interference. Perspective widens ripples near us.
            offset = ((.5 + y / 90) * math.sin(x / 37 + y / 21 + layer * 2) +
                      .8 * math.sin(x / 13 - y / 17))
            at = y + offset
            alpha = max(max(0, min(1, (at - lo + 1.2) / 1.2,
                                      (hi + 1.2 - at) / 1.2)) for lo, hi in bands)
            row.append(round(alpha * 255))
        rows.append(bytes(row))
    png(f"ripple-{layer + 1}.png", 920, 270, rows)

rng = random.Random(7)
png("grain.png", 220, 220,
    [bytes(value for _ in range(220) for value in (255, 255, 255, rng.randrange(48, 93)))
     for _ in range(220)], color_type=6)
