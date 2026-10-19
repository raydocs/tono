import sys
from PIL import Image
def lin(c):
    c=c/255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def L(p): r,g,b=p[:3]; return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
def measure(path, x,y,w,h, scale=3, dark_text=False):
    im=Image.open(path).convert('RGB')
    box=(int(x*scale),int(y*scale),int((x+w)*scale),int((y+h)*scale))
    px=[L(p) for p in im.crop(box).getdata()]
    px.sort(); n=len(px)
    if dark_text:
        text=px[int(n*0.03)]; bg=px[int(n*0.6)]
    else:
        text=px[int(n*0.97)]; bg=px[int(n*0.4)]
    hi,lo=max(text,bg),min(text,bg)
    return (hi+0.05)/(lo+0.05), text, bg
for spec in sys.argv[1:]:
    name,path,x,y,w,h,*dark=spec.split(',')
    r,t,b=measure(path,float(x),float(y),float(w),float(h),dark_text=bool(dark))
    print(f"{name:40s} {r:5.2f}:1  text L={t:.3f} bg L={b:.3f}")
