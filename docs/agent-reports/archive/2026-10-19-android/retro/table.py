import json,subprocess
from datetime import datetime
def T(s): return datetime.strptime(s[:19],'%Y-%m-%dT%H:%M:%S')
def mins(a,b): return (T(b)-T(a)).total_seconds()/60
runs=[l.rstrip('\n').split('\t') for l in open('runs.tsv')]
runs.sort(key=lambda r:r[5])
jobs=[l.rstrip('\n').split('\t') for l in open('jobs.tsv')]
emu={x['job']:x for x in json.load(open('emu.json'))}
def subj(sha):
    r=subprocess.run(['git','-C','../mono','log','-1','--format=%s',sha],capture_output=True,text=True)
    return r.stdout.strip()[:90] or '?'
lines=[]
for rid,sha,att,st,concl,created,started,updated,ev in runs:
    lines.append(f"\n## {rid} {sha} attempts={att} {concl} created {created} ended {updated} wall {mins(created,updated):.1f} min")
    lines.append(f"   commit: {subj(sha)}")
    for r,a,jid,name,jc,js,je in sorted([j for j in jobs if j[0]==rid],key=lambda j:(j[1],j[3])):
        if a!=att and 'build' in name: continue
        dur=mins(js,je) if js and je else -1
        s=f"   a{a} {name:18} {jc:9} {js[11:19]}–{je[11:19]} {dur:5.1f} min"
        x=emu.get(jid)
        if x:
            for i,se in enumerate(x['sessions']):
                boot=mins(se['start'],se['booted']) if se['booted'] else None
                res=se['results']; p=sum(r.startswith('PASS') for r in res); f=sum(r.startswith('FAIL') for r in res)
                h=[r.split()[1] for r in res if r.startswith('HANG')]; g=[r for r in res if 'HEALTH-GATE' in r]; o=[r for r in res if 'OFFLINE' in r]; b=[r for r in res if r.startswith('BUDGET')]
                fails=[r.split()[1] for r in res if r.startswith('FAIL')]
                tests=mins(se['booted'],se['term']) if se['booted'] and se['term'] else None
                s+=f"\n      emu{i+1}: boot {boot*60:.0f}s" if boot is not None else f"\n      emu{i+1}: boot ?"
                s+=f" frame {','.join(se['health']) or '-'}ms; booted→terminate {tests:.1f} min" if tests else f" frame {','.join(se['health']) or '-'}; no terminate"
                s+=f"; PASS {p} FAIL {f}"+(f" {fails}" if fails else "")+(f" HANG {h}" if h else "")+(" GATE" if g else "")+(" OFFLINE" if o else "")+(" BUDGET" if b else "")+(f" junit {se['junit']}" if se.get('junit') else "")
            if x.get('flaky'): s+="\n      FLAKY (passed on retry)"
        lines.append(s)
open('table.txt','w').write('\n'.join(lines))
