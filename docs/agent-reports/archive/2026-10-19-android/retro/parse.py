import re,os,json
jobs=[l.rstrip('\n').split('\t') for l in open('jobs.tsv')]
out=[]
for run,att,jid,name,concl,st,en in jobs:
    if 'emulator' not in name: continue
    f=f'logs2/{jid}.txt'
    rec=dict(run=run,att=att,job=jid,name=name,concl=concl,start=st,end=en,sessions=[])
    if not os.path.exists(f) or os.path.getsize(f)==0: rec['note']='log unavailable'; out.append(rec); continue
    cur=None
    for line in open(f,errors='replace'):
        p=['','',line.lstrip('\ufeff').rstrip('\n')]
        if len(p)<3: continue
        m=re.match(r'(\S+Z) (.*)',p[2])
        if not m: continue
        t,msg=m.group(1),m.group(2)
        if msg.startswith('Starting emulator'):
            cur=dict(start=t,booted=None,health=[],results=[],term=None); rec['sessions'].append(cur); continue
        if cur is None: continue
        if msg.startswith('Emulator booted') and not cur['booted']: cur['booted']=t
        if msg.startswith('##[group]Terminate Emulator'): cur['term']=t
        mm=re.match(r"(?:\+ echo '?)?((PASS|FAIL) [a-z][0-9]?[\w-]*)'?$",msg)
        if mm and mm.group(1) not in cur['results']: cur['results'].append(mm.group(1))
        mm=re.match(r"\+ echo '?(HEALTH-GATE[^']*)",msg)
        if mm: cur['results'].append(mm.group(1))
        mm=re.match(r"(Tests run: \d+,\s+Failures: \d+|OK \(\d+ tests?\))",msg)
        if mm: cur.setdefault('junit',[]).append(mm.group(1))
        mm=re.match(r"\+ echo 'health: sign-in screen (?:median )?frame (\S+) ms",msg)
        if mm: cur['health'].append(mm.group(1))
        if re.match(r'(HANG: |DEVICE-OFFLINE|BUDGET)',msg): cur['results'].append(msg)
        if msg.startswith('FLAKY'): rec['flaky']=True
    out.append(rec)
json.dump(out,open('emu.json','w'),indent=1)
