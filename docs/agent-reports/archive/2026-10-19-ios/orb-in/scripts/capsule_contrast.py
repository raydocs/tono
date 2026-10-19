import sys
from PIL import Image
def lin(c):
    v=c/255
    return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
def measure(path, box):
    im=Image.open(path).convert('RGB').crop(box)
    lum=sorted(0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b) for r,g,b in im.getdata())
    bg=lum[len(lum)//2]
    t=lum[len(lum)*97//100] if bg<0.18 else lum[len(lum)*3//100]
    mx=lum[-len(lum)//200]
    return round((max(t,bg)+0.05)/(min(t,bg)+0.05),2), round((mx+0.05)/(bg+0.05),2), round(bg,4)
s=3
for f in sys.argv[1:]:
    whole=(22*s,664*s,380*s,720*s)
    text=(40*s,676*s,110*s,708*s)
    print(f, 'whole', measure(f,whole), 'label-box', measure(f,text))
