import sys
from PIL import Image
mark=(0xFF,0xB4,0xA0); night=(6,7,0xF)
looks=[tuple(int(mark[i]*(1-s)+night[i]*s) for i in range(3)) for s in (0,0.45,0.55)]
for f in sys.argv[1:]:
    im=Image.open(f).convert('RGB'); w,h=im.size; band=int(h*0.06); px=im.load(); hits=0
    for y in range(0,band,2):
        for x in range(0,w,2):
            p=px[x,y]
            if any(sum(abs(p[i]-c[i]) for i in range(3))<24 for c in looks): hits+=1
    print(hits>40, hits, f.split('/')[-1])
