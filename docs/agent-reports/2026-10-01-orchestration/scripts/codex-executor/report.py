#!/usr/bin/env python3
"""Regenerate W1_CODEX_STATUS.md and per-slot findings markdown from out/*/ tsv files."""
import os, glob, subprocess, json, re, datetime
B='/workspace/w1-codex'; O='/workspace/orchestrator'
meta=json.load(open(f'{B}/slots.json'))
def tsv(p):
    if not os.path.exists(p): return []
    return [l.rstrip('\n').split('\t') for l in open(p) if l.strip()]
def classify(v):
    v=v.lower()
    if 'false' in v or v.startswith('fp'): return 'fp'
    if 'dup' in v or 'claimed' in v: return 'dup'
    if 'fixed' in v or 'real' in v: return 'real'
    return 'other'
quota=subprocess.run(['python3','/workspace/sol2-bughunt/quota.py','--pct'],capture_output=True,text=True).stdout.strip()
now=datetime.datetime.now().strftime('%Y-%m-%d %H:%M MT')
rows=[]; os.makedirs(f'{B}/report-out',exist_ok=True)
for key,m in meta.items():
    F=tsv(f'{B}/out/{key}/findings.tsv'); P=tsv(f'{B}/out/{key}/prs.tsv')
    c={'real':0,'fp':0,'dup':0,'other':0}
    for f in F: c[classify(f[5] if len(f)>5 else '')]+=1
    prs=' '.join(f'#{p[0].lstrip("#")}' for p in P)
    rows.append(f"| {key} | {m.get('account','Codex acct 2')} | {m.get('state','')} | {m.get('start','')} | {m.get('end','')} | {c['real']} real / {c['fp']} FP / {c['dup']} dup |{' '+prs if prs else ''} |")
    if F or P:
        md=[f'# {key}: Codex (GPT-6.1 Sol) findings','',f'Generated {now} from the run\'s findings.tsv / prs.tsv.','','## PRs','','| PR | Branch | Labels | Auto-merge requested | Title |','|---|---|---|---|---|']
        md+=[ '| '+' | '.join((p+['']*5)[:5]).replace('\n',' ')+' |' for p in P]
        md+=['','## Hypotheses','','| ID | Area | Sev | Location | Description | Verdict |','|---|---|---|---|---|---|']
        md+=[ '| '+' | '.join(x.replace('|','/') for x in (f+['']*6)[:6])+' |' for f in F]
        open(f'{B}/report-out/codex-{key}-findings.md','w').write('\n'.join(md)+'\n')
st=open(f'{B}/status-head.md').read().replace('__NOW__',now).replace('__QUOTA__',quota)
st+='\n| Slot | Account | State | Started | Finished | Findings | PRs |\n|---|---|---|---|---|---|---|\n'+'\n'.join(rows)+'\n'
st+=open(f'{B}/status-tail.md').read()
open(f'{O}/W1_CODEX_STATUS.md','w').write(st); open(f'{B}/report-out/W1_CODEX_STATUS.md','w').write(st)
print(st)
