from pathlib import Path
from PIL import Image
import json,bisect
p=Path('/tmp/tono-pr2-review-20261005/final');runs=json.loads((p/'s0-sunset-timestamps.json').read_text())['runs'];out={}
for name,run in runs.items():
 frames=[]
 for f in run['frames']:
  im=Image.open(p/f['file']).convert('L').crop((0,56,920,600)).resize((92,54));frames.append({'file':f['file'],'timestamp':f['timestamp'],'mean':sum(im.get_flattened_data())/(92*54)})
 ts=[x['timestamp'] for x in frames];ys=[x['mean'] for x in frames]
 def at(t):
  i=max(0,bisect.bisect_right(ts,t)-1)
  if i==len(ts)-1:return ys[i]
  return ys[i]+(ys[i+1]-ys[i])*(t-ts[i])/(ts[i+1]-ts[i])
 anchors=sorted(set(ts+[t-.3 for t in ts if t-.3>=ts[0]]));steps=[at(t+.3)-at(t) for t in anchors if t+.3<=ts[-1]];direct=[b['mean']-a['mean'] for a in frames for b in frames if .295<=b['timestamp']-a['timestamp']<=.305]
 out[name]={'first':ys[0],'last':ys[-1],'maxRolling300':max(map(abs,steps)),'maxRise300':max(steps),'maxFall300':min(steps),'direct300Max':max(map(abs,direct),default=None),'directPairs':len(direct),'maxGapMs':max((b-a)*1000 for a,b in zip(ts,ts[1:])),'frames':len(frames),'samples':frames};print(name,{k:round(v,4) if isinstance(v,float) else v for k,v in out[name].items() if k!='samples'})
out['nightDifference']=abs(out['on']['last']-out['off']['last']);(p/'s0-sunset-results.json').write_text(json.dumps(out,indent=2)+'\n');assert out['on']['maxRolling300']<=8;assert out['on']['maxRise300']<=1;assert out['nightDifference']<=1.5;assert abs(out['on']['last']-27.3)<=1.5;print('PASS sampled/interpolated rolling300<=8, no material upward reversal; control night difference<=1.5. Not an exact300ms frame cadence.')
