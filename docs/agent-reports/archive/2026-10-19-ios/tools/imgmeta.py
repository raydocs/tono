#!/usr/bin/env python3
"""Lists ancillary metadata in every PNG (text/exif/time chunks), JPEG (APP1/COM segments) and GIF
(comment/application extensions) under the roots. Prints counts and every text payload (truncated)."""
import os, sys, struct, zlib, collections
c = collections.Counter(); out = []
def png(p, b):
    i = 8
    while i + 8 <= len(b):
        n, t = struct.unpack(">I4s", b[i:i+8]); t = t.decode("latin1"); d = b[i+8:i+8+n]; i += 12 + n
        if t in ("IHDR", "IDAT", "IEND", "PLTE", "tRNS"): continue
        c["png:" + t] += 1
        if t == "tEXt": out.append((p, t, d.replace(b"\0", b"=")[:160]))
        elif t == "zTXt": k, _, r = d.partition(b"\0"); out.append((p, t, k + b"=" + zlib.decompress(r[1:])[:160]))
        elif t == "iTXt": out.append((p, t, d.replace(b"\0", b"|")[:200]))
        elif t == "eXIf": out.append((p, t, d[:80]))
def jpg(p, b):
    i = 2
    while i + 4 <= len(b) and b[i] == 0xFF:
        m = b[i+1]
        if m == 0xDA: break
        n = struct.unpack(">H", b[i+2:i+4])[0]; d = b[i+4:i+2+n]
        if m == 0xE1 or m == 0xFE or (0xE2 <= m <= 0xEF):
            c[f"jpg:{m:02X}"] += 1; out.append((p, f"{m:02X}", d[:120]))
        i += 2 + n
def gif(p, b):
    for tag, name in ((b"\x21\xfe", "comment"), (b"\x21\xff", "appext")):
        k = b.count(tag)
        if k: c["gif:" + name] += k
        j = b.find(tag)
        if j >= 0: out.append((p, name, b[j+2:j+40]))
n = 0
for root in sys.argv[1:]:
    for dp, _, fns in os.walk(root):
        for fn in fns:
            p = os.path.join(dp, fn); l = fn.lower()
            if not l.endswith((".png", ".jpg", ".jpeg", ".gif")): continue
            b = open(p, "rb").read(); n += 1
            if b[:8] == b"\x89PNG\r\n\x1a\n": png(p, b)
            elif b[:2] == b"\xff\xd8": jpg(p, b)
            elif b[:3] == b"GIF": gif(p, b)
            else: c["unknown-signature"] += 1; out.append((p, "sig", b[:8]))
print("images", n); print(dict(c))
seen = collections.Counter()
for p, t, d in out:
    key = (t, bytes(d[:60]))
    seen[key] += 1
    if seen[key] <= 2: print(p, t, d)
print("distinct payloads", len(seen))
for k, v in seen.most_common(40): print(v, k)
