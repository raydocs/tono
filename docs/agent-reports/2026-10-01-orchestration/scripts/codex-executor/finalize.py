#!/usr/bin/env python3
"""finalize.py KEY "areas covered" "unfinished" : append slot results to box LEDGER/COVERAGE, copy final report, regen codex-ledger/coverage."""
import sys, os, json, shutil, datetime
B='/workspace/w1-codex'; O='/workspace/orchestrator'
key, covered, unfinished = sys.argv[1], sys.argv[2], sys.argv[3]
now=datetime.datetime.now().strftime('%H:%M MT')
def tsv(p): return [l.rstrip('\n').split('\t') for l in open(p) if l.strip()] if os.path.exists(p) else []
F=tsv(f'{B}/out/{key}/findings.tsv'); P=tsv(f'{B}/out/{key}/prs.tsv')
os.makedirs(f'{B}/report-out',exist_ok=True)
if os.path.exists(f'{B}/runs/{key}/final.md'): shutil.copy(f'{B}/runs/{key}/final.md', f'{B}/report-out/codex-{key}-report.md')
rows=[]
for f in F:
    f=(f+['']*6)[:6]; v=f[5]
    if 'false' in v.lower(): continue  # ledger keeps real/dup/decision; FPs live in per-slot file
    rows.append(f'| {f[0]} | {f[1]} | Sol (Codex acct 2, {key}) | {f[2]} | {v.replace("|","/")} | {f[4].replace("|","/")} [{f[3]}] |')
fp=sum(1 for f in F if len(f)>5 and 'false' in f[5].lower())
block=f'\n### {key} (finished {now}; {len(F)} hypotheses, {fp} FP, PRs: {" ".join("#"+p[0].lstrip("#") for p in P)})\n| ID | Area | Model | Sev | Verdict | Description [location] |\n|---|---|---|---|---|---|\n'+'\n'.join(rows)+'\n'
cov=f'| {key} | {covered} | Sol (Codex acct 2) | finished {now} | unfinished: {unfinished} | PRs: {" ".join("#"+p[0].lstrip("#") for p in P)} |\n'
for path,hdr,text in [(f'{O}/LEDGER.md','\n## Codex account-2 slot results (Sol, executor)\n',block),(f'{O}/COVERAGE.md','\n## Codex acct-2 coverage (Sol, executor)\n| Slot | Areas covered | Model | State | Gaps | PRs |\n|---|---|---|---|---|---|\n',cov)]:
    s=open(path).read()
    if hdr.strip() not in s: s+=hdr
    s+=text; open(path,'w').write(s)
for name,path,hdr in [('codex-ledger.md',f'{O}/LEDGER.md','## Codex account-2 slot results'),('codex-coverage.md',f'{O}/COVERAGE.md','## Codex acct-2 coverage')]:
    s=open(path).read(); part=s[s.index(hdr):]
    open(f'{B}/report-out/{name}','w').write(f'# {name[:-3]} (Codex account 2 slots; mirrored from the orchestrator {os.path.basename(path)} on the box)\n\n'+part)
print('ok', key, len(F), fp, len(P))
