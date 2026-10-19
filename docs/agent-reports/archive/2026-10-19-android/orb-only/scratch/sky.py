import sys
from PIL import Image
for f in sys.argv[1:]:
    im=Image.open(f).convert('RGB'); w,h=im.size; px=im.load(); s=n=0
    for y in range(int(h*0.08),int(h*0.45),6):
        for x in range(0,w,6):
            r,g,b=px[x,y]; s+=0.2126*r+0.7152*g+0.0722*b; n+=1
    print(round(s/n,1), f.split('/')[-1])
