# Offline twin of TonoUITests.labelContrast. Usage: label.py <png> <WxH+X+Y crop in px>
import sys, subprocess
img, geo = sys.argv[1], sys.argv[2]
both = False
w, h = map(int, geo.split('+')[0].split('x'))
raw = subprocess.run(["magick", img, "-crop", geo, "+repage", "-depth", "8", "rgb:-"], capture_output=True).stdout
px = [tuple(raw[i:i+3]) for i in range(0, len(raw), 3)]
inks = [(247,243,238),(42,20,6)]
def lin(c):
    v = c/255; return v/12.92 if v <= 0.04045 else ((v+0.055)/1.055)**2.4
def lum(p): return 0.2126*lin(p[0])+0.7152*lin(p[1])+0.0722*lin(p[2])
ERODE = True
def near(x,y,k):
    if not (0<=x<w and 0<=y<h): return False
    p = px[y*w+x]; return all(abs(p[i]-k[i])<=12 for i in range(3))
def core(x,y):
    for k in inks:
        if near(x,y,k) and (not ERODE or all(near(x+dx,y+dy,k) for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)))): return True
    return False
rows = [sum(core(x,y) for x in range(w)) for y in range(h)]
ys = [y for y in range(h) if rows[y] >= 2]
if not ys:
    print(f"no glyph cores in either ink ({sum(rows)} isolated); the element metric decides"); sys.exit(0)
top, bottom = ys[0], ys[-1]
def side(x, rng):
    v = [lum(px[y*w+x]) for y in rng if 0 <= y < h and not core(x,y)]
    return sum(v)/len(v) if v else None
r = []
for y in range(top, bottom+1):
    for x in range(w):
        if core(x,y):
            l = lum(px[y*w+x]); a = side(x, range(top-5, top-1)); b = side(x, range(bottom+2, bottom+6))
            s = [a,b] if both else [v for v in (a,b) if v is not None]
            if both and (a is None or b is None): continue
            s = [v for v in s if v is not None]
            if not s: continue
            r.append(min((max(l,v)+.05)/(min(l,v)+.05) for v in s))
r.sort()
print(f"band {top}-{bottom} of {h}, cores {sum(rows)}, measured {len(r)}, median {r[len(r)//2] if r else None}")
