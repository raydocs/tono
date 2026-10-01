#!/usr/bin/env python3
# Manager v2 (strict off). Loop: enable auto-merge on queued/auto-requested non-UI PRs, fix DIRTY (DECISIONS rebase / helper bump),
# rerun failed ci-gate once then comment+skip, batch-merge green docs-only PRs, watch main CI. Stop: touch /tmp/mgr2.stop
import json,subprocess,time,os,re,datetime
R='raydocs/tono'; W='/workspace/merge-work'; B=W+'/bin'
UI={724,725}  # policy 19:39: ui-review PRs merge like any other; only telemetry waits
EXCL={691,694,663,204,203}
def sh(cmd,**k): return subprocess.run(cmd,shell=True,capture_output=True,text=True,**k)
def log(*a):
    print(datetime.datetime.now().strftime('%H:%M:%S'),*a,flush=True)
def rd(f):
    try: return [l.strip() for l in open(f) if l.strip()]
    except FileNotFoundError: return []
DOC=re.compile(r'^(docs/|.*\.md$)')
last_docs=0; seen_main=set(rd(W+'/mainfail-seen.txt')); last_main=0
while not os.path.exists('/tmp/mgr2.stop'):
    r=sh(f"gh pr list -R {R} --state open --limit 250 --json number,title,headRefName,headRefOid,baseRefName,isDraft,mergeStateStatus,autoMergeRequest,labels,files,statusCheckRollup")
    try: prs=json.loads(r.stdout)
    except Exception: log('list failed',r.stderr[:200]); time.sleep(60); continue
    queue=[int(x) for x in rd(W+'/queue.txt')]; skip=set(rd(W+'/skip2.txt')); rerun=set(rd(W+'/rerun.txt')); commented=set(rd(W+'/commented.txt'))
    docs_ready=[]
    for p in sorted(prs,key=lambda p:(queue.index(p['number']) if p['number'] in queue else 9999, p['number'])):
        n=p['number']; h=p['headRefOid']; labels={l['name'] for l in p['labels']}; auto=p['autoMergeRequest'] is not None
        isui = n in UI
        dnm = bool(re.search(r'do[ -]not[ -]merge|不要合',p['title'],re.I)) or 'do-not-merge' in labels or str(n) in rd(W+'/exclude.txt')
        if dnm:
            if auto: sh(f"gh pr merge {n} -R {R} --disable-auto"); log(f"#{n} do-not-merge: auto-merge OFF")
            continue
        if isui or n in EXCL:
            if auto and isui: sh(f"gh pr merge {n} -R {R} --disable-auto"); log(f"#{n} UI: auto-merge OFF")
            continue
        if p['baseRefName']!='main': continue
        files=[f['path'] for f in p['files']]
        docs = bool(files) and all(DOC.search(f) for f in files)
        gate=[c for c in p['statusCheckRollup'] if c.get('name')=='ci-gate']
        gst=(gate[0].get('status'),gate[0].get('conclusion')) if gate else (None,None)
        fails=[c for c in p['statusCheckRollup'] if c.get('conclusion') in ('FAILURE','TIMED_OUT') and c.get('name')!='ci-gate']
        target = n in queue or auto
        if docs:
            if p['isDraft']: continue
            if auto: sh(f"gh pr merge {n} -R {R} --disable-auto"); log(f"#{n} docs: auto-merge OFF (batched)")
            if gst==('COMPLETED','SUCCESS') and p['mergeStateStatus'] not in ('DIRTY','BLOCKED','UNKNOWN'): docs_ready.append(n)
            continue
        if not target: continue
        key=f"{n}:{h}"
        if key in skip: continue
        if p['mergeStateStatus']=='DIRTY':
            o=sh(f"{B}/rebase.sh {n}")
            if o.returncode==0:
                po=sh(f"{B}/push.sh {n}"); log(f"#{n} DIRTY -> DECISIONS rebase pushed: {(po.stdout+po.stderr).strip()[-120:]}")
            else:
                bo=sh(f"{B}/bumphelper.sh {n}")
                if bo.returncode==0 and 'OK bump-' in bo.stdout:
                    br,bh=open(f'/tmp/bump-{n}.head').read().split()
                    po=sh(f"cd {W}/wt && git push origin bump-{n}:refs/heads/{br}")
                    log(f"#{n} DIRTY -> merged main in ({[l for l in bo.stdout.splitlines() if l.startswith('main=') or l.startswith('OK')]}) push rc={po.returncode}")
                else:
                    log(f"#{n} DIRTY needs manual rebase: {(o.stdout+o.stderr).strip()[-150:]} | {(bo.stdout+bo.stderr).strip()[-150:]}")
                    open(W+'/skip2.txt','a').write(key+'\n'); open(W+'/manual2.txt','a').write(f"{key} {datetime.datetime.now():%H:%M}\n")
                    try:
                        sh(f"cd {W}/tono && git fetch -q origin main +pull/{n}/head:refs/pr/{n}")
                        cf=[l for l in sh(f"cd {W}/tono && git merge-tree --write-tree --name-only --no-messages origin/main refs/pr/{n}").stdout.splitlines()[1:] if l.strip()]
                        cf=[f for f in cf if not f.endswith('DECISIONS.md')] or cf
                        if cf and key not in set(rd(W+'/conflictcommented.txt')):
                            body="Merge sweep: this branch now conflicts with main in "+", ".join(f"`{f}`" for f in cf)+". That is not a DECISIONS-only or helper-version conflict, so I did not resolve it mechanically. It needs a rebase onto main by its owner; once it is green it goes back in the merge queue."
                            open('/tmp/cc.md','w').write(body)
                            r2=sh(f"gh pr comment {n} -R {R} --body-file /tmp/cc.md")
                            open(W+'/conflictcommented.txt','a').write(key+'\n'); log(f"#{n} conflict comment rc={r2.returncode}")
                    except Exception as e: log(f"#{n} conflict comment error {e}")
            continue
        if gst[0]=='COMPLETED' and gst[1] in ('FAILURE','CANCELLED') and fails:
            url=fails[0].get('detailsUrl',''); m=re.search(r'/runs/(\d+)/job/(\d+)',url)
            if key not in rerun and m:
                sh(f"gh run rerun {m.group(1)} -R {R} --failed"); open(W+'/rerun.txt','a').write(key+'\n'); log(f"#{n} ci-gate failed ({fails[0]['name']}); reran run {m.group(1)}")
            elif m:
                lg=sh(f"gh api repos/{R}/actions/jobs/{m.group(2)}/logs").stdout.splitlines()
                ex=[l[29:] for l in lg if re.search(r'error|Error|FAIL|panicked|failed|REGRESSION|assert',l)][-12:]
                if key not in commented:
                    body=f"Merge sweep: `ci-gate` failed twice on {h[:8]} (re-run once). Failing check: **{fails[0]['name']}** ({url}).\n\n```\n"+'\n'.join(ex)[-2500:]+"\n```\nAuto-merge stays on; push a fix and it merges once green."
                    open('/tmp/cbody.md','w').write(body); sh(f"gh pr comment {n} -R {R} --body-file /tmp/cbody.md")
                    open(W+'/commented.txt','a').write(key+'\n')
                open(W+'/skip2.txt','a').write(key+'\n'); open(W+'/failed2.txt','a').write(f"{key} {fails[0]['name']} {url}\n"); log(f"#{n} failed twice ({fails[0]['name']}); commented, skipping this head")
            continue
        if p['isDraft']:
            if n in queue: sh(f"gh pr ready {n} -R {R}"); log(f"#{n} marked ready")
            else: continue
        if not auto:
            o=sh(f"gh pr merge {n} -R {R} --auto --merge")
            if o.returncode!=0 and 'clean status' in o.stderr and gst==('COMPLETED','SUCCESS'):
                o2=sh(f"gh pr merge {n} -R {R} --merge"); log(f"#{n} green+clean -> merged directly rc={o2.returncode} {o2.stderr.strip()[:100]}")
            else: log(f"#{n} auto-merge ON" + ('' if o.returncode==0 else ' FAILED '+o.stderr.strip()[:100]))
    now=time.time()
    if docs_ready and now-last_docs>900:
        last_docs=now
        for n in docs_ready:
            o=sh(f"gh pr merge {n} -R {R} --merge"); log(f"#{n} docs batch merge rc={o.returncode} {o.stderr.strip()[:100]}")
    # main CI watch
    if now-last_main>120:
        last_main=now
        o=sh(f"gh run list -R {R} --branch main --event push --limit 30 --json databaseId,workflowName,conclusion,headSha,status")
        try:
            for run in json.loads(o.stdout):
                if run['conclusion']=='failure' and str(run['databaseId']) not in seen_main:
                    seen_main.add(str(run['databaseId'])); open(W+'/mainfail-seen.txt','a').write(str(run['databaseId'])+'\n')
                    log(f"MAIN-FAIL {run['workflowName']} {run['headSha'][:8]} run {run['databaseId']}")
        except Exception: pass
    time.sleep(90)
