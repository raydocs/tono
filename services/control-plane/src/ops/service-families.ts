// Host → service-family map used by the traffic-audit segment parser.
//
// `etld1` is a small embedded public-suffix subset (the compound ccTLDs listed
// in COMPOUND_SUFFIXES, then "last two labels" for everything else). It is not
// the Public Suffix List: `foo.github.io` collapses to `github.io`, and
// unlisted compounds such as `s3.amazonaws.com` are similarly under-split.
// Never fetches; never updates at runtime.
//
// Muse: Meta's 2026-09-08 launch names `muse.ai` as the web surface
// (https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/);
// WHOIS on muse.ai lists Meta Platforms, Inc. with facebook.com nameservers.

const words = (value: string): readonly string[] => value.split(/\s+/).filter(Boolean);

export const SERVICE_FAMILIES_VERSION = 1;

export const FAMILY_IDS = [
  'claude', 'chatgpt', 'grok', 'gemini', 'meta', 'perplexity',
  'github', 'google', 'microsoft', 'apple', 'telegram',
  'wechat', 'qq', 'feishu', 'lark', 'dingtalk', 'wecom',
  'tencent_meeting', 'trae', 'wps', 'baidu_netdisk', 'alipan',
  'douyin', 'bilibili', 'netease_music', 'qq_music', 'xunlei',
  'jianying', 'youdao', 'awesun',
  'chrome', 'edge', 'safari', 'firefox', 'arc', 'brave',
  'other',
] as const;

export type FamilyId = (typeof FAMILY_IDS)[number];

const FAMILY_ID_SET = new Set<string>(FAMILY_IDS);

export function isFamilyId(value: string): value is FamilyId {
  return FAMILY_ID_SET.has(value);
}

// First-party assistant suffixes reused from CLAUDE_HOME_DOMAINS (tono-core
// config.rs), split by product. Shared install/telemetry hosts in that list
// (Cloudflare, Datadog, Stripe, npm, Sentry, Homebrew) are not attributed
// here — they are not product identity. Gemini/Grok hosts that are more
// specific than eTLD+1 are kept as full suffixes so they win over google.
export const SERVICE_FAMILIES: { readonly [K in FamilyId]: readonly string[] } = {
  claude: words(`
    anthropic.com claude.ai claude.com claude.app claude.site clau.de anthropic.ai
    claudestudio.com claudemcpclient.com claudemcpcontent.com claudeusercontent.com
    servd-anthropic-website.b-cdn.net
  `),
  chatgpt: words('chatgpt.com openai.com chat.com ai.com oaistatic.com oaiusercontent.com'),
  grok: words('grok.com grok.x.com grokipedia.com x.ai'),
  gemini: words(`
    gemini.google.com bard.google.com aistudio.google.com
    generativelanguage.googleapis.com notebooklm.google.com
  `),
  meta: words(`
    facebook.com fb.com fbcdn.net facebook.net instagram.com cdninstagram.com
    whatsapp.com whatsapp.net meta.ai meta.com muse.ai
  `),
  perplexity: words('perplexity.ai perplexity.com pplx.ai'),
  github: words('github.com githubusercontent.com githubassets.com github.io ghcr.io'),
  google: words(`
    google.com googleapis.com gstatic.com googleusercontent.com youtube.com
    ytimg.com googlevideo.com ggpht.com android.com google.cn gvt1.com
  `),
  microsoft: words(`
    microsoft.com live.com office.com office365.com microsoftonline.com
    windows.net azure.com msn.com outlook.com xbox.com skype.com onedrive.com
    sharepoint.com visualstudio.com azureedge.net microsoftapp.net
  `),
  apple: words('apple.com icloud.com mzstatic.com cdn-apple.com apple-dns.net me.com itunes.com aaplimg.com'),
  telegram: words('telegram.org t.me telegram.me tdesktop.com split.to telegram.dog'),
  wechat: words('wechat.com weixin.com weixin.qq.com wechatapp.com servicewechat.com'),
  qq: words('qq.com gtimg.com qpic.cn qlogo.cn'),
  feishu: words('feishu.cn feishu.com feishucdn.com'),
  lark: words('larksuite.com lark.com larksso.com'),
  dingtalk: words('dingtalk.com dingtalkapps.com dingding.xin'),
  wecom: words('work.weixin.qq.com wework.qpic.cn'),
  tencent_meeting: words('meeting.tencent.com voovmeeting.com wemeet.tencent.com'),
  trae: words('trae.ai trae.com'),
  wps: words('wps.cn wps.com kdocs.cn wpscdn.com'),
  baidu_netdisk: words('pan.baidu.com baidupcs.com'),
  alipan: words('alipan.com aliyundrive.com'),
  douyin: words('douyin.com iesdouyin.com'),
  bilibili: words('bilibili.com bilivideo.com hdslb.com biliapi.net'),
  netease_music: words('music.163.com'),
  qq_music: words('y.qq.com'),
  xunlei: words('xunlei.com xunlei.cn'),
  jianying: words('capcut.com jianying.com jianyingpro.com'),
  youdao: words('youdao.com youdaocdn.com'),
  awesun: words('awesun.com'),
  chrome: words('chrome.com googlechrome.com'),
  edge: words('microsoftedge.microsoft.com edge.microsoft.com'),
  safari: words(''),
  firefox: words('mozilla.org mozilla.com firefox.com mozilla.net'),
  arc: words('arc.net'),
  brave: words('brave.com'),
  other: words(''),
};

const SUFFIX_INDEX: Array<{ suffix: string; family: FamilyId }> = [];
for (const id of FAMILY_IDS) {
  if (id === 'other') continue;
  for (const suffix of SERVICE_FAMILIES[id]) {
    SUFFIX_INDEX.push({ suffix: suffix.toLowerCase(), family: id });
  }
}
SUFFIX_INDEX.sort((a, b) => b.suffix.length - a.suffix.length);

// Compound public suffixes the brief names, plus the usual neighbours so
// `foo.co.uk` does not collapse to `co.uk`. Anything not listed uses the
// last two labels.
const COMPOUND_SUFFIXES = new Set(words(`
  co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk
  com.cn net.cn org.cn gov.cn edu.cn ac.cn
  com.au net.au org.au edu.au gov.au id.au
  com.hk org.hk net.hk edu.hk gov.hk idv.hk
  com.tw org.tw net.tw edu.tw gov.tw idv.tw
  co.jp ne.jp or.jp ac.jp go.jp ad.jp ed.jp gr.jp
  co.kr or.kr ne.kr ac.kr go.kr re.kr
  co.nz net.nz org.nz ac.nz govt.nz
  com.sg net.sg org.sg edu.sg gov.sg per.sg
  co.in net.in org.in ac.in gov.in edu.in res.in gen.in firm.in ind.in
  com.br net.br org.br gov.br edu.br
  com.mx org.mx gob.mx edu.mx
  co.za org.za web.za net.za gov.za ac.za
  com.tr org.tr net.tr gov.tr edu.tr
  co.id or.id go.id ac.id web.id
  com.vn net.vn org.vn edu.vn gov.vn
  com.my net.my org.my edu.my gov.my
  co.th or.th ac.th go.th in.th net.th
  com.ar org.ar gob.ar edu.ar
  co.il org.il ac.il gov.il net.il
  com.ua net.ua org.ua gov.ua
  com.pl net.pl org.pl gov.pl
`));

const DOMESTIC_ETLD1 = new Set(words(`
  qq.com baidu.com taobao.com tmall.com jd.com weixin.qq.com bilibili.com
  douyin.com aliyun.com 163.com sina.com.cn zhihu.com xiaohongshu.com
  meituan.com alipay.com bytedance.com kuaishou.com weibo.com pinduoduo.com
  iqiyi.com youku.com csdn.net gitee.com huawei.com mi.com xiaomi.com
  oppo.com vivo.com tencent.com alibaba.com 1688.com alicdn.com hdslb.com
  toutiao.com 126.com netease.com sohu.com weibo.cn 360.cn byteimg.com
  myqcloud.com qcloud.com chinaunicom.com chinamobile.com
`));

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function isIpLiteral(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (!value) return false;
  if (IPV4.test(value)) return true;
  const unbracketed = value.startsWith('[') && value.endsWith(']')
    ? value.slice(1, -1)
    : value;
  return unbracketed.includes(':') && IPV6.test(unbracketed);
}

export function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const slash = value.indexOf('/');
  if (slash >= 0) value = value.slice(0, slash);
  const at = value.lastIndexOf('@');
  if (at >= 0) value = value.slice(at + 1);
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close >= 0) value = value.slice(1, close);
  } else {
    const colon = value.lastIndexOf(':');
    if (colon >= 0 && /^\d+$/.test(value.slice(colon + 1))) {
      value = value.slice(0, colon);
    }
  }
  while (value.endsWith('.')) value = value.slice(0, -1);
  return value;
}

export function etld1(host: string): string {
  const value = normalizeHost(host);
  if (!value) return '';
  if (isIpLiteral(value)) return '__ip__';
  const labels = value.split('.').filter(Boolean);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0].slice(0, 253);
  const maxCompound = Math.min(labels.length - 1, 4);
  for (let take = maxCompound; take >= 2; take--) {
    const suffix = labels.slice(-take).join('.');
    if (!COMPOUND_SUFFIXES.has(suffix)) continue;
    const start = labels.length - take - 1;
    const picked = start < 0 ? suffix : labels.slice(start).join('.');
    return picked.slice(0, 253);
  }
  return labels.slice(-2).join('.').slice(0, 253);
}

export function familyForHost(host: string): FamilyId | null {
  const value = normalizeHost(host);
  if (!value || isIpLiteral(value)) return null;
  for (const { suffix, family } of SUFFIX_INDEX) {
    if (value === suffix || value.endsWith(`.${suffix}`)) return family;
  }
  return null;
}

export function isLikelyDomestic(value: string): boolean {
  const etld = value.trim().toLowerCase();
  if (!etld || etld === '__ip__' || etld === '__other__') return false;
  if (etld === 'cn' || etld.endsWith('.cn')) return true;
  return DOMESTIC_ETLD1.has(etld);
}
