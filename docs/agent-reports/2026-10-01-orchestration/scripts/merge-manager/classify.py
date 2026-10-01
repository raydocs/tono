import json,re,subprocess,sys
R='raydocs/tono'
prs=json.loads(subprocess.check_output(['gh','pr','list','-R',R,'--state','open','--limit','300','--json','number,title,labels,headRefName,isDraft,files']))
DOC=re.compile(r'^(docs/|.*\.md$|.*/tests?/|.*Tests?/|.*\.test\.|.*_test\.|.*tests?\.rs$|.*Tests\.swift$)')
UI=re.compile(r'^(apps/windows/app/src/(?!.*\.test\.)|apps/macos/Tono/(Views|UI|Resources/Assets|Components)/|services/ops-console/(src|app|components|styles)/|.*\.(css|scss|svg)$)')
LOCALE=re.compile(r'/locales/|Localizable|\.strings$|\.xcstrings$')
HW=re.compile(r'^(apps/windows/service/src/|tooling/scripts/core-helper/|apps/windows/app/src-tauri/src/(tono|core)/.*(connection|dns|wfp|kill|route|tun|network|heal|probe|update|monitor|restore|proxy|websocket|ws_|service|health)|apps/windows/crates/tono-core/src/.*(sing_box|dns|route|heal|config|runtime|tun|network|mihomo|probe)|apps/macos/Tono/.*(KillSwitch|DNS|Dns|Network|Uplink|Connect|Heal|Helper|SystemProxy|Proxy|Tun|TUN|Route|Update|ConfigPipeline|SingBox|WebSocket|Sidecar|ExitHeal|Reconnect|CoreManager|Hy2))')
out=[]
for p in prs:
    labels={l['name'] for l in p['labels']}
    files=[f['path'] for f in p['files']]
    src=[f for f in files if not DOC.search(f)]
    ui=[f for f in src if UI.search(f) or LOCALE.search(f)]
    hw=[f for f in src if HW.search(f) and not UI.search(f) and not f.startswith('services/') and not f.startswith('.github/')]
    KNOWNUI={713,716,717,719,721,723,726,731,735,737,739,743,745,746,747,748,734,805}
    UIT=re.compile(r'(\bUI\b|dashboard|card|page|popover|onboarding|layout|design|redesign|visual|tagline|checklist|prototype|ops-console|运维后台|界面)',re.I)
    isui = p['number'] in KNOWNUI or (bool(src) and len(ui)==len(src) and bool(UIT.search(p['title'])) and not p['title'].lower().startswith('fix'))
    mixed = bool(ui) and not isui and any(UI.search(f) for f in ui)
    out.append(dict(n=p['number'],t=p['title'][:60],br=p['headRefName'],labels=sorted(labels),ui=isui,mixed=mixed,hw=bool(hw),hwf=hw[:2],nsrc=len(src)))
json.dump(out,open('/workspace/merge-work/classify.json','w'),indent=0)
for o in out:
    need=[]
    if o['hw'] and 'needs-hardware' not in o['labels'] and not o['ui']: need.append('+needs-hardware')
    pass  # policy 19:39: no ui-review labeling
    if (o['n']>=749 or o['n'] in (714,715,718,720,722,740,741,742,738)) and (need): print(o['n'],o['br'][:40],o['labels'],need,'MIXED' if o['mixed'] else '',o['hwf'],'|',o['t'])

if len(sys.argv)>1 and sys.argv[1]=='apply':
    import datetime
    for o in out:
        if o['n'] in (691,694,204,203): continue
        if o['n']<749 and o['n'] not in (714,715,718,720,722,738,740,741,742) and not o['ui']: continue
        add=[]
        pass  # policy 19:39: no ui-review labeling
        if o['hw'] and not o['ui'] and 'needs-hardware' not in o['labels'] and not o['t'].lower().startswith('test'): add.append('needs-hardware')
        for l in add:
            r=subprocess.run(['gh','api','-X','POST',f'repos/{R}/issues/{o["n"]}/labels','-f',f'labels[]={l}'],capture_output=True,text=True)
            print(datetime.datetime.now().strftime('%H:%M:%S'),'label',l,'#%d'%o['n'],'ok' if r.returncode==0 else r.stderr[:100])
        pass  # policy 19:39: do not disable auto-merge on UI PRs
