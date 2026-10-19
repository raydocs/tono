import sys, subprocess
def lin(c):
    v=c/255; return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
def m(path,x,y,w,h,s=3):
    raw=subprocess.run(["magick",path,"-crop",f"{int(w*s)}x{int(h*s)}+{int(x*s)}+{int(y*s)}","+repage","-depth","8","rgb:-"],capture_output=True,check=True).stdout
    lum=[0.2126*lin(raw[i])+0.7152*lin(raw[i+1])+0.0722*lin(raw[i+2]) for i in range(0,len(raw),3)]
    bg=sorted(lum)[len(lum)//2]; r=lambda l:(max(l,bg)+.05)/(min(l,bg)+.05)
    ink=sorted(x for x in map(r,lum) if x>=1.5)
    core=ink[len(ink)*9//10] if len(ink)>=max(20,len(lum)//2000) else (ink[-1] if ink else 1)
    return round(bg,4), round(core,2), f"{len(ink)*100/len(lum):.2f}%"
print(m(sys.argv[1],*map(float,sys.argv[2:6])))
for g in (0.41,0.49):
    L=lin(round(g*255)); print(g, "vs bg", )
