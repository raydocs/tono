import re, sys, xml.etree.ElementTree as ET
H='/home/user/workspace/repo/.amp/in/handoff/android/mobile/src/main/res/'
OUT='/home/user/workspace/repo/apps/ios/App/Resources/'
DROP={'switch_hint_off','switch_hint_on','switch_hint_busy','switch_a11y','duration_just','duration_minutes','duration_hours',
      'notification_channel','settings_apps','settings_apps_none','settings_apps_count','apps_search','apps_done',
      'system_on','system_lockdown','system_off','system_open','action_disconnect'}
OVR={
 'en':{
  'sentence_permission':"iOS asks once before Tono can add its VPN configuration.",
  'reason_REVOKED':"Tono's VPN configuration was removed or another VPN took over.",
  'reason_DENIED':"Adding the VPN configuration was declined.",
  'routing_platform':"On iPhone, all apps, all TCP/UDP ports, IPv4 and IPv6 enter the tunnel. LAN, link-local and multicast stay outside, as do Apple push and cellular services (calls, SMS). DNS for direct names uses your network's resolver; matched names never reach it. iOS has no per-app rules: Tono recognises AI only by domain and the Anthropic address range, and cannot exclude or include individual apps.",
  'routing_scope':"Order: 21 cloud video exceptions → 166 AI / named Home entries (plus the Anthropic address range) → explicit cloud list → everything else direct. Matched traffic that fails is blocked, never retried directly; matched UDP/QUIC is refused so apps fall back to TCP. Apps using ECH, their own DNS-over-HTTPS, or cached addresses can hide an AI service; that traffic then goes direct. Unrecognised AI is not guaranteed to use Home.",
  'settings_system':"iOS VPN protection",
  'system_include_all':"Include all networks",
  'system_include_all_desc':"On (recommended): iOS sends all traffic to Tono and holds it while the tunnel restarts instead of letting it out directly. Takes effect the next time Tono connects.",
  'system_on_demand':"Connecting turns on iOS Connect On Demand, so iOS brings Tono back after a crash, an update or a restart; disconnecting turns it off.",
  'system_limit':"While Tono is switched off, iOS does not block anything, and some Apple system services can bypass any VPN.",
  'about_contract':"Routing lists: desktop contract, digest %1$@",
  'about_test':"Test build for evaluation. Not an App Store release.",
  'sentence_connected_stable_no_home':"All public traffic via cloud · LAN stays local",
  'lane_home_short':"Home",
  'lane_local_short':"Direct",
  'lane_no_home_short':"No Home assigned",
  'state_degraded':'Partly working',
  'state_permission':'Needs permission',
  'action_connect':'Connect',
  'action_cancel':'Cancel',
  'action_allow_vpn':'Allow VPN',
  'action_disconnecting':'Disconnecting…',
  'a11y_cancel_connect':'Cancel connecting',
  'action_disconnect':'Disconnect',
  'status_exit_both':'Cloud %1$s · Home %2$s',
  'status_exit_cloud':'Cloud %1$s',
  'status_protected':'Protected',
  'sentence_preparing':'Checking account and lines…',
  'sentence_connecting':'Building the encrypted route…',
  'sentence_permission_short':'Allow the VPN once to start',
  'short_HOME_UNREACHABLE':'Home not answering · AI paused',
  'short_CLOUD_UNREACHABLE':'Cloud not answering · matched traffic held',
  'short_HOME_UNAVAILABLE':'Home exit unavailable',
  'short_NETWORK':"Can't reach Tono",
  'short_DENIED':'Allow the VPN to continue',
  'short_REVOKED':'Another VPN took over',
  'short_CORE_START':"The core didn't start",
  'short_RATE_LIMITED':'Too many attempts',
  'short_SESSION_ENDED':'Please sign in again',
  'short_CATALOG_ROLLBACK':'Line list refused (older than before)',
  'short_CORE_STOPPED':'The tunnel stopped',
  'details':'Details',
  'details_routes':'Where traffic goes',
  'details_why':'What happened',
  'details_mode':'Routing mode',
  'signin_intro':'Sign in with an email code. No password.',
  'settings_close':'Close settings',
  'a11y_connected_for':'Connected for %1$@',
 },
 'zh':{
  'sentence_permission':"首次使用时 iOS 会请你允许 Tono 添加 VPN 配置。",
  'reason_REVOKED':"Tono 的 VPN 配置被移除，或另一个 VPN 接管了。",
  'reason_DENIED':"你没有允许添加 VPN 配置。",
  'routing_platform':"在 iPhone 上，所有应用、所有 TCP/UDP 端口以及 IPv4、IPv6 都进入隧道；局域网、链路本地、组播，以及 Apple 推送和蜂窝服务（电话、短信）不进入。直连域名用你当前网络的 DNS 解析，命中名单的域名不会发给它。iOS 没有按应用分流：Tono 只按域名和 Anthropic 地址段识别 AI，也无法单独排除或加入某个应用。",
  'routing_scope':"优先级：21 项云端视频例外 → 166 项 AI／指定 Home 条目（另含 Anthropic 地址段）→ 明确的云端列表 → 其他全部直连。命中的流量失败时会被拦住，不会退回直连；命中的 UDP/QUIC 会被拒绝，应用会改用 TCP。使用 ECH、自带 DoH 或缓存地址的应用可能隐藏 AI 身份，这部分会走直连；无法保证未识别的 AI 走家宽。",
  'settings_system':"iOS 系统保护",
  'system_include_all':"包含所有网络",
  'system_include_all_desc':"开启（推荐）：iOS 把所有流量交给 Tono，隧道重启期间先拦住，而不是直接放行。下次连接时生效。",
  'system_on_demand':"连接时会开启 iOS“按需连接”，Tono 崩溃、更新或手机重启后由 iOS 自动恢复；断开时关闭。",
  'system_limit':"Tono 关闭时 iOS 不拦截任何流量；部分 Apple 系统服务可以绕过任何 VPN。",
  'about_contract':"路由名单：桌面合同，摘要 %1$@",
  'about_test':"供评估的测试版，不是 App Store 正式版。",
  'sentence_connected_stable_no_home':"公网流量全部走云 · 局域网仍走本地",
  'lane_home_short':"家宽",
  'lane_local_short':"本地直连",
  'lane_no_home_short':"未分配家宽",
  'state_degraded':'部分可用',
  'action_connect':'连接',
  'action_cancel':'取消',
  'action_allow_vpn':'允许 VPN',
  'action_disconnecting':'断开中…',
  'a11y_cancel_connect':'取消连接',
  'action_disconnect':'断开',
  'status_exit_both':'云端 %1$s · 家宽 %2$s',
  'status_exit_cloud':'云端 %1$s',
  'status_protected':'已保护',
  'sentence_preparing':'核对账号与线路…',
  'sentence_connecting':'建立加密线路…',
  'sentence_permission_short':'首次使用需允许一次 VPN',
  'short_HOME_UNREACHABLE':'家宽没响应 · AI 已暂停',
  'short_CLOUD_UNREACHABLE':'云端没响应 · 命中流量已拦住',
  'short_HOME_UNAVAILABLE':'家宽出口暂不可用',
  'short_NETWORK':'连不上 Tono',
  'short_DENIED':'需要允许 VPN',
  'short_REVOKED':'VPN 被其他应用接管',
  'short_CORE_START':'内核没能启动',
  'short_RATE_LIMITED':'尝试太频繁',
  'short_SESSION_ENDED':'请重新登录',
  'short_CATALOG_ROLLBACK':'线路列表异常，已拒绝',
  'short_CORE_STOPPED':'隧道已停止',
  'details':'详情',
  'details_routes':'流量去向',
  'details_why':'发生了什么',
  'details_mode':'路由模式',
  'signin_intro':'用邮箱验证码登录，无需密码。',
  'settings_close':'关闭设置',
  'a11y_connected_for':'已连接 %1$@',
 }}
def esc(v): return v.replace('\\','\\\\').replace('"','\\"').replace('\n','\\n')
for lang, src, dst in [('en','values','en.lproj'),('zh','values-zh-rCN','zh-Hans.lproj')]:
    root=ET.parse(H+src+'/strings.xml').getroot()
    pairs=[]
    for e in root.findall('string'):
        k=e.get('name')
        if k in DROP: continue
        v=OVR[lang].get(k, e.text or '')
        v=v.replace("\\'","'").replace('\\"','"')
        v=re.sub(r'%(\d)\$s', r'%\1$@', v)
        v=re.sub(r'%(\d)\$d', r'%\1$ld', v)
        pairs.append((k,v))
    keys={k for k,_ in pairs}
    for k,v in OVR[lang].items():
        if k not in keys:
            pairs.append((k, re.sub(r'%(\d)\$s', r'%\1$@', v)))
    import os; os.makedirs(OUT+dst, exist_ok=True)
    with open(OUT+dst+'/Localizable.strings','w') as f:
        f.write('/* Tono iOS copy. Keys and wording are shared with Android res/values{,-zh-rCN}/strings.xml; iOS-only keys at the end. */\n\n')
        for k,v in pairs: f.write(f'"{k}" = "{esc(v)}";\n')
    print(dst, len(pairs))
