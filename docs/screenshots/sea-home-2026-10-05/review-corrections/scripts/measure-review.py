from pathlib import Path
from PIL import Image,ImageChops
import math,json,bisect
p=Path('/tmp/tono-pr2-review-20261005/final')
def L(c):
 v=[x/255 for x in c];v=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v];return sum(x*y for x,y in zip(v,[.2126,.7152,.0722]))
contrast=[]
for b in json.loads((p/'contrast-boxes.json').read_text()):
 im=Image.open(p/(b['name']+'.png')).convert('RGB');worst=(100,None)
 for y in range(math.ceil(b['y']),math.floor(b['y']+b['height'])):
  for x in range(math.ceil(b['x']),math.floor(b['x']+b['width'])):
   rgb=im.getpixel((x,y));fg=[a*.94+z*.06 for a,z in zip([246,242,236],rgb)];r=(L(fg)+.05)/(L(rgb)+.05)
   if r<worst[0]:worst=(r,{'x':x,'y':y,'rgb':rgb})
 contrast.append({**b,'minimum':worst[0],'worstPixel':worst[1],'pass':worst[0]>=4.5})
(p/'contrast-results.json').write_text(json.dumps(contrast,indent=2)+'\n')
profiles=[]
for b in json.loads((p/'wash-profile-boxes.json').read_text()):
 on=Image.open(p/f"wash-{b['quality']}-on.png").convert('RGB');off=Image.open(p/f"wash-{b['quality']}-off.png").convert('RGB');y=220
 start=round(b['x']+b['width']*.6-160);end=round(b['x']+b['width']*.6)
 vals=[]
 for x in range(start-10,end+11):
  aa=on.getpixel((x,y));bb=off.getpixel((x,y));ratios=[(z-a)/(z-base) for a,z,base in zip(aa,bb,[10,8,15]) if z-base>20];vals.append({'x':x,'alpha':sum(ratios)/len(ratios) if ratios else None})
 profiles.append({**b,'row':y,'expectedStart':start,'expectedEnd':end,'computedFeatherWidth':160,'profile':vals,'alphaAtStart':vals[10]['alpha'],'alphaAtEnd':vals[-11]['alpha'],'largestAdjacentAlphaJump':max(abs(z['alpha']-a['alpha']) for a,z in zip(vals,vals[1:]) if a['alpha']is not None and z['alpha']is not None)})
(p/'wash-profiles.json').write_text(json.dumps(profiles,indent=2)+'\n')
a=Image.open(p/'near-light-on.png').convert('RGB');b=Image.open(p/'near-light-off.png').convert('RGB');delta=ImageChops.difference(a,b);bbox=delta.getbbox();box=json.loads((p/'near-light-boxes.json').read_text());horizon=box['column']['y'];cs=delta.crop((0,math.ceil(horizon+60),a.width,a.height));sky=delta.crop((0,0,a.width,math.floor(horizon)));d={'boxes':box,'pixelDeltaBounds':bbox,'maxRgbDelta':max(v for pair in delta.getextrema() for v in pair),'outsideLower60PxDeltaBounds':cs.getbbox(),'skyDeltaBounds':sky.getbbox(),'confinedToFirst60Px':bbox is not None and bbox[1]>=math.floor(horizon) and bbox[3]<=math.ceil(horizon+60) and cs.getbbox()is None and sky.getbbox()is None};(p/'near-light-results.json').write_text(json.dumps(d,indent=2)+'\n')
print('contrast',[(b['w'],b['full'],round(b['minimum'],4),b['pass']) for b in contrast]);print('wash',[(b['quality'],b['computedFeatherWidth'],b['alphaAtStart'],b['alphaAtEnd'],b['largestAdjacentAlphaJump']) for b in profiles]);print('near-light',d)
assert all(b['pass'] for b in contrast),'contrast below4.5';assert all(b['largestAdjacentAlphaJump']<.06 for b in profiles),'wash hard edge';assert d['confinedToFirst60Px'],'field outside requested band'
