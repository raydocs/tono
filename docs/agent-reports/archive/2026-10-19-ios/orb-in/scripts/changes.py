import sys, os
from PIL import Image, ImageChops
d=sys.argv[1]; fs=sorted(os.listdir(d))
prev=None; out=[]
for i,f in enumerate(fs):
    im=Image.open(os.path.join(d,f)).convert('L')
    # title band only: left 75%, top 60% of crop
    w,h=im.size; band=im.crop((0,0,int(w*0.8),int(h*0.55)))
    if prev is not None:
        diff=ImageChops.difference(band,prev)
        s=sum(diff.get_flattened_data())/ (band.size[0]*band.size[1])
        if s>1.0: out.append((i,round(s,1)))
    prev=band
print(out)
