import sys, subprocess
def lin(c):
    v=c/255; return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
def measure(path, x,y,w,h, scale=3):
    geo=f"{int(w*scale)}x{int(h*scale)}+{int(x*scale)}+{int(y*scale)}"
    raw=subprocess.run(["magick",path,"-crop",geo,"+repage","-depth","8","rgb:-"],capture_output=True,check=True).stdout
    lum=sorted(0.2126*lin(raw[i])+0.7152*lin(raw[i+1])+0.0722*lin(raw[i+2]) for i in range(0,len(raw),3))
    bg=lum[len(lum)//2]; out={}
    for p in (97,98,99,99.5):
        t= lum[min(len(lum)-1,int(len(lum)*p/100))] if bg<0.18 else lum[int(len(lum)*(100-p)/100)]
        out[p]=round((max(t,bg)+0.05)/(min(t,bg)+0.05),2)
    ink=sum(1 for l in lum if (max(l,bg)+.05)/(min(l,bg)+.05)>3)/len(lum)
    return out, f"ink>3:1 {ink*100:.2f}%", len(lum)
print(measure(sys.argv[1], *map(float, sys.argv[2:6])))
