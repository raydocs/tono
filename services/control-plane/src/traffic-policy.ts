import { type Env, type Row, requiredCatalogKey } from './env';
import { sha256, decryptTrafficPolicy, verifyTrafficPolicySignature } from './crypto';
import { ApiError } from './errors';

export type TrafficPolicy = {
  version: 1 | 2 | 3 | 4;
  domains: Array<{ host: string; ports: number[] }>;
  mediaEndpoints: Array<{ address: string; ports: number[] }>;
  webDomains?: Array<{ host: string; ports: number[] }>;
  directSuffixes?: Array<{ host: string; ports: number[] }>;
  tcpEndpoints?: Array<{ address: string; ports: number[] }>;
};

export const emptyTrafficPolicy = (): TrafficPolicy => ({ version: 1, domains: [], mediaEndpoints: [] });

export function exactKeys(value: Row, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function canonicalPorts(value: unknown, allowed: number[], name: string) {
  if (!Array.isArray(value) || value.length === 0 || value.some((port) => !Number.isInteger(port) || !allowed.includes(port))) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  if (new Set(value).size !== value.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Duplicate ${name}`);
  }
  return [...value].sort((a, b) => a - b) as number[];
}

export function isPublicIPv4(address: string) {
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(address)) return false;
  const octets = address.split('.').map(Number);
  if (octets.some((part) => part > 255)) return false;
  const [a, b, c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
    (a === 203 && b === 0 && c === 113));
}

// `trusted` is set only once an Ed25519 signature over the resulting canonical
// document has verified against the compiled-in public key. It relaxes exactly
// one thing: the lists of hostnames permitted to route direct. Every other check
// stays, because a signature says who wrote the document, not that the document
// is well formed — a signed policy with a malformed entry or one list too long
// would be faithfully delivered to every client and break all of them.
//
// `protectedSuffixes` is NOT relaxed, and must never be. Those are the hosts that
// must never leave the tunnel, including this control plane itself. Folding them
// into what a signature can override would make a leaked private key sufficient
// to expose the traffic the product exists to protect, which is a strictly worse
// position than the allowlist this mechanism replaces.
export function canonicalTrafficPolicy(value: unknown, trusted = false): TrafficPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid policy');
  }
  const policy = value as Row;
  const isVersion1 = policy.version === 1 &&
    exactKeys(policy, ['version', 'domains', 'mediaEndpoints']);
  const isVersion2 = policy.version === 2 &&
    exactKeys(policy, ['version', 'domains', 'mediaEndpoints', 'webDomains']);
  const isVersion3 = policy.version === 3 &&
    exactKeys(policy, ['version', 'domains', 'mediaEndpoints', 'webDomains', 'directSuffixes']);
  const isVersion4 = policy.version === 4 &&
    exactKeys(policy, ['version', 'domains', 'mediaEndpoints', 'webDomains', 'directSuffixes', 'tcpEndpoints']);
  if ((!isVersion1 && !isVersion2 && !isVersion3 && !isVersion4) ||
      !Array.isArray(policy.domains) || policy.domains.length > 32 ||
      !Array.isArray(policy.mediaEndpoints) || policy.mediaEndpoints.length > 64 ||
      ((isVersion2 || isVersion3 || isVersion4) &&
        (!Array.isArray(policy.webDomains) || policy.webDomains.length > 32)) ||
      ((isVersion3 || isVersion4) &&
        (!Array.isArray(policy.directSuffixes) || policy.directSuffixes.length > 64)) ||
      (isVersion4 &&
        (!Array.isArray(policy.tcpEndpoints) || policy.tcpEndpoints.length > 64))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid traffic policy version or shape');
  }
  const allowedWeChatSuffixes = ['qq.com', 'qq.com.cn', 'qpic.cn', 'qlogo.cn', 'gtimg.cn', 'gtimg.com', 'wechat.com', 'weixin.com', 'weixinbridge.com', 'wxs.qq.com'];
  // `domains` is the application-direct set. The field predates the office
  // clients and keeps its wire name for compatibility, but its admission is
  // now shared by WeChat, DingTalk and Feishu/Lark. The client still requires
  // a reviewed process identity before a raw-IP socket can use this surface.
  const allowedNativeDirectSuffixes = [
    ...allowedWeChatSuffixes,
    'feishu.cn', 'feishucdn.com', 'larksuite.com', 'larkoffice.com',
    'feishu.net', 'feishuapp.cn', 'feishuapp.com', 'feishudoc.cn',
    'feishudoc.com', 'feishumeetings.cn', 'feishumeetings.com',
    'feishuimg.com', 'feishukacdn.com', 'larkofficecdn.com',
    'larkofficeimg.com', 'larkcloud.com', 'larkcloud.net',
    'getfeishu.cn', 'getfeishu.com', 'feishupkg.com', 'feishuvc.cn',
    'feishuvc.com', 'securityfeishu.cn', 'securityfs.cn', 'statusfeishu.cn',
    // Feishu's official client firewall list includes these shared service
    // namespaces. Keep them native-app-only; browser suffix routing stays
    // narrower so a signed-client policy cannot widen ordinary web traffic.
    'zjurl.cn', 'snssdk.com', 'pstatp.com', 'byteimg.com',
    'bytedance.net', 'bytedance.com', 'byted-static.com', 'bytegoofy.com',
    'feishu-3rd-party-services.com', 'bytehwm.com', 'ttwebview.com',
    'bytegecko.com', 'bytescm.com', 'kundou.cn', 'bytetos.com',
    'zijieapi.com', 'byteeffecttos.com', 'bytednsdoc.com', 'bytedanceapi.com',
    'volcvideo.com', 'feelgood.cn', 'baseopendev.com', 'bytedapm.com',
    'ibytedapm.com', 'larkenterprise.com', 'aiforce.cloud', 'aiforce.run',
    'dingtalk.cn', 'dingtalk.com', 'dingtalk.net', 'dingtalkapps.com',
    'dingtalkcloud.com', 'dingding.xin', 'ztna-dingtalk.com', 'ddurl.to',
  ];
  const allowedWebSuffixes = [
    'bilibili.com', 'biliapi.net', 'bilivideo.com', 'hdslb.com', 'qq.com',
    'gtimg.cn', 'gtimg.com', 'iqiyi.com', 'qiyi.com', 'qiyipic.com',
    'iqiyipic.com', 'youku.com', 'ykimg.com', 'xiaohongshu.com',
    'xhslink.com', 'xhscdn.com', 'feishu.cn', 'feishucdn.com',
    'larksuite.com', 'larkoffice.com', 'feishu.net', 'feishuapp.cn',
    'feishuapp.com', 'feishudoc.cn', 'feishudoc.com', 'feishumeetings.cn',
    'feishumeetings.com', 'feishuimg.com', 'feishukacdn.com',
    'larkofficecdn.com', 'larkofficeimg.com', 'larkcloud.com',
    'larkcloud.net', 'getfeishu.cn', 'getfeishu.com', 'feishupkg.com',
    'feishuvc.cn', 'feishuvc.com', 'securityfeishu.cn', 'securityfs.cn',
    'statusfeishu.cn', 'dingtalk.cn', 'dingtalk.com', 'dingtalk.net',
    'dingtalkapps.com', 'dingtalkcloud.com', 'dingding.xin',
    'ztna-dingtalk.com', 'ddurl.to', 'baidu.com', 'baidupcs.com',
    'bcebos.com', 'baidubcs.com', 'bdstatic.com', 'bdimg.com',
    'aliyuncs.com', '10jqka.com.cn', 'iwencai.com', 'eastmoney.com',
    'dfcfw.com', 'sina.com.cn', 'sinajs.cn', 'legulegu.com', 'optbbs.com',
    '100ppi.com', 'awtmt.com', 'cls.cn', 'cninfo.com.cn', 'ccxe.com.cn',
    'pushplus.plus', 'baostock.com', 'sse.com.cn', 'szse.cn', 'zoom.us',
    'zoom.com',
    'zoomgov.com', 'oray.com', 'sunlogin.com', 'edu.cn',
    'taobao.com', 'tmall.com', 'alipay.com', 'alicdn.com',
    'jd.com', 'douyin.com', 'weibo.com', 'meituan.com',
    'dianping.com', 'pinduoduo.com', 'amap.com',
    'douyu.com', 'huya.com', 'kuaishou.com', 'yximgs.com', 'yy.com',
    'ixigua.com', 'mgtv.com', 'acfun.cn', 'sohu.com', '1905.com',
    'miguvideo.com', 'wps.cn', 'kdocs.cn', 'yuque.com',
    'voovmeeting.com', 'teambition.com', 'shimo.im', 'lanhuapp.com',
    '12306.cn', 'zhipin.com', '51job.com',
    'kugou.com', 'kgimg.com', 'kuwo.cn', 'migu.cn',
    'ximalaya.com', 'qingting.fm', 'lizhi.fm',
    'xylink.com', 'zhumu.me', 'quanshi.com',
  ];
  const allowedWebExactHosts = ['ykimg.alicdn.com'];
  // NARROWING THESE LISTS IS A BREAKING OPERATION. `publicTrafficPolicy` runs the
  // stored policy back through this function on every read, so removing an entry
  // that the live policy still uses turns every policy fetch into a 503 and
  // disables managed direct routing fleet-wide. Republish the policy without the
  // entry first, then narrow. Widening is safe; the client re-validates against
  // its own allowlist and rejects anything it does not recognise.
  //
  // Several entries here are namespaces where a third party chooses the hostname
  // — `aliyuncs.com` and `bcebos.com`/`baidubcs.com` are tenant object storage,
  // `edu.cn` spans thousands of independent institutions, `oray.com`/
  // `sunlogin.com` relay arbitrary remote-access sessions. They remain in the
  // signed policy contract for compatibility, but the Windows client deliberately
  // emits only the reviewed Bilibili family as address-free suffix routes; other
  // suffixes stay tunnelled there. Platform clients must keep their own runtime
  // suffix allowlist narrower than this control-plane acceptance list.
  const allowedDirectSuffixes = [
    'bilibili.com', 'biliapi.net', 'bilivideo.com', 'hdslb.com',
    'qq.com', 'gtimg.cn', 'gtimg.com', 'iqiyi.com', 'qiyi.com',
    'qiyipic.com', 'iqiyipic.com', 'youku.com', 'ykimg.com',
    'xiaohongshu.com', 'xhslink.com', 'xhscdn.com', 'feishu.cn',
    'feishucdn.com', 'larksuite.com', 'larkoffice.com', 'feishu.net',
    'feishuapp.cn', 'feishuapp.com', 'feishudoc.cn', 'feishudoc.com',
    'feishumeetings.cn', 'feishumeetings.com', 'feishuimg.com',
    'feishukacdn.com', 'larkofficecdn.com', 'larkofficeimg.com',
    'larkcloud.com', 'larkcloud.net', 'getfeishu.cn', 'getfeishu.com',
    'feishupkg.com', 'feishuvc.cn', 'feishuvc.com', 'securityfeishu.cn',
    'securityfs.cn', 'statusfeishu.cn', 'dingtalk.cn', 'dingtalk.com',
    'dingtalk.net', 'dingtalkapps.com', 'dingtalkcloud.com', 'dingding.xin',
    'ztna-dingtalk.com', 'ddurl.to', 'baidu.com',
    'baidupcs.com', 'bcebos.com', 'baidubcs.com', 'bdstatic.com',
    'bdimg.com', 'aliyuncs.com', '10jqka.com.cn', 'iwencai.com',
    'eastmoney.com', 'dfcfw.com', 'sina.com.cn', 'sinajs.cn',
    'legulegu.com', 'optbbs.com', '100ppi.com', 'awtmt.com', 'cls.cn',
    'cninfo.com.cn', 'ccxe.com.cn', 'pushplus.plus', 'baostock.com',
    'sse.com.cn', 'szse.cn', 'zoom.us', 'zoom.com', 'zoomgov.com', 'oray.com',
    'sunlogin.com', 'edu.cn', '163.com', 'netease.com', '126.net',
    'taobao.com', 'tmall.com', 'alipay.com', 'alicdn.com',
    'jd.com', 'douyin.com', 'weibo.com', 'meituan.com',
    'dianping.com', 'pinduoduo.com', 'amap.com',
    'douyu.com', 'huya.com', 'kuaishou.com', 'yximgs.com', 'yy.com',
    'ixigua.com', 'mgtv.com', 'acfun.cn', 'sohu.com', '1905.com',
    'miguvideo.com', 'wps.cn', 'kdocs.cn', 'yuque.com',
    'voovmeeting.com', 'teambition.com', 'shimo.im', 'lanhuapp.com',
    '12306.cn', 'zhipin.com', '51job.com',
    'kugou.com', 'kgimg.com', 'kuwo.cn', 'migu.cn',
    'ximalaya.com', 'qingting.fm', 'lizhi.fm',
    'xylink.com', 'zhumu.me', 'quanshi.com',
  ];
  const protectedSuffixes = [
    'anthropic.com', 'claude.ai', 'claude.com', 'claude.app', 'claude.site',
    'clau.de', 'anthropic.ai', 'claudestudio.com', 'claudemcpclient.com',
    'claudemcpcontent.com', 'claudeusercontent.com',
    'servd-anthropic-website.b-cdn.net', 'challenges.cloudflare.com',
    'cf-assets.www.cloudflare.com', 'cloudflareinsights.com',
    'browser-intake-datadoghq.com', 'browser-intake-us5-datadoghq.com',
    'browser-intake-us3-datadoghq.com', 'browser-intake-ap1-datadoghq.com',
    'browser-intake-ap2-datadoghq.com', 'browser-intake-datadoghq.eu',
    'browser-intake-ddog-gov.com',
    'datadoghq.com', 'statsig.com', 'statsigapi.net', 'featuregates.org',
    'growthbook.io', 'stripe.com', 'stripecdn.com', 'link.com', 'hcaptcha.com', 'stripe.network', 'storage.googleapis.com',
    'registry.npmjs.org', 'raw.githubusercontent.com', 'formulae.brew.sh',
    'sentry.io',
    'tono.app', 'tono.com',
  ];
  const seenHosts = new Set<string>();
  const canonicalDomains = (
    values: unknown[],
    allowedSuffixes: string[],
    allowedExactHosts: string[],
    web: boolean,
  ) => values.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !exactKeys(entry as Row, ['host', 'ports'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid domain entry');
    }
    const { host, ports } = entry as Row;
    if (typeof host !== 'string' || host.length > 253 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host) ||
        protectedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)) ||
        seenHosts.has(host)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate domain host');
    }
    // Reviewed by list, or vouched for by a signature. Evaluated after the type
    // and syntax checks above so a non-string host is a 400 rather than a
    // TypeError from `endsWith` surfacing as a 500.
    if (!trusted && !allowedExactHosts.includes(host) &&
        !allowedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate domain host');
    }
    seenHosts.add(host);
    const canonical = canonicalPorts(ports, web ? [443] : [80, 443], 'domain ports');
    if (web && (canonical.length !== 1 || canonical[0] !== 443)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Web direct domains require TCP port 443');
    }
    return { host, ports: canonical };
  }).sort((a, b) => a.host < b.host ? -1 : a.host > b.host ? 1 : 0);
  const domains = canonicalDomains(
    policy.domains,
    allowedNativeDirectSuffixes,
    [],
    false,
  );
  const seenAddresses = new Set<string>();
  const mediaEndpoints = policy.mediaEndpoints.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !exactKeys(entry as Row, ['address', 'ports'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid media endpoint');
    }
    const { address, ports } = entry as Row;
    if (typeof address !== 'string' || !isPublicIPv4(address) || seenAddresses.has(address)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate media address');
    }
    seenAddresses.add(address);
    return { address, ports: canonicalPorts(ports, [443, 8000], 'media ports') };
  }).sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  if (isVersion1) return { version: 1, domains, mediaEndpoints };
  const webDomains = canonicalDomains(
    policy.webDomains as unknown[],
    allowedWebSuffixes,
    allowedWebExactHosts,
    true,
  );
  if (isVersion2) return { version: 2, domains, mediaEndpoints, webDomains };
  // Duplicates must be rejected here, not just deduplicated: the client treats a
  // repeated suffix as a malformed policy and discards the whole revision, so a
  // duplicate accepted at this boundary silently disables managed direct routing
  // on every device until someone republishes.
  const seenSuffixes = new Set<string>();
  const directSuffixes = (policy.directSuffixes as unknown[]).map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !exactKeys(entry as Row, ['host', 'ports'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid direct suffix');
    }
    const { host, ports } = entry as Row;
    // The syntax check is explicit rather than implied by list membership. While
    // every accepted suffix had to appear in `allowedDirectSuffixes`, that list
    // *was* the syntax guarantee; a signature relaxing membership would otherwise
    // leave this field with no validation at all and hand clients a suffix they
    // have to parse.
    //
    // A signature vouches for authorship, not for judgement. A wildcard suffix
    // over a namespace where a third party picks the hostname still lets anyone
    // who can host there obtain a real IP outside the tunnel — see the note above
    // `allowedDirectSuffixes`. Signing moves that review from this code to
    // whoever holds the key; it does not remove it.
    if (typeof host !== 'string' || host.length > 253 ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host) ||
        protectedSuffixes.some((suffix) =>
          host === suffix || host.endsWith(`.${suffix}`) || suffix.endsWith(`.${host}`)) ||
        seenSuffixes.has(host)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate direct suffix host');
    }
    if (!trusted && !allowedDirectSuffixes.includes(host)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate direct suffix host');
    }
    seenSuffixes.add(host);
    return { host, ports: canonicalPorts(ports, [80, 443], 'direct suffix ports') };
  }).sort((a, b) => a.host < b.host ? -1 : a.host > b.host ? 1 : 0);
  if (isVersion3) return { version: 3, domains, mediaEndpoints, webDomains, directSuffixes };

  const seenTCPAddresses = new Set<string>();
  const tcpEndpoints = (policy.tcpEndpoints as unknown[]).map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !exactKeys(entry as Row, ['address', 'ports'])) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid TCP endpoint');
    }
    const { address, ports } = entry as Row;
    if (typeof address !== 'string' || !isPublicIPv4(address) ||
        seenTCPAddresses.has(address)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid or duplicate TCP address');
    }
    seenTCPAddresses.add(address);
    return { address, ports: canonicalPorts(ports, [80, 443], 'TCP endpoint ports') };
  }).sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  return {
    version: 4,
    domains,
    mediaEndpoints,
    webDomains,
    directSuffixes,
    tcpEndpoints,
  };
}

export async function publicTrafficPolicy(e: Env) {
  const row = await e.DB.prepare(
    'SELECT revision, ciphertext, nonce, content_sha256, updated_at, signature FROM managed_traffic_policy WHERE singleton_id = 1',
  ).first<Row>();
  if (!row) {
    const json = JSON.stringify(emptyTrafficPolicy());
    return { revision: 0, json, sha256: await sha256(json), updatedAt: undefined };
  }
  try {
    const json = await decryptTrafficPolicy(String(row.ciphertext), String(row.nonce), requiredCatalogKey(e));
    const digest = await sha256(json);
    if (digest !== row.content_sha256) throw new Error('digest mismatch');
    const signature = typeof row.signature === 'string' && row.signature.length
      ? row.signature
      : undefined;
    // A stored signature is what permits trusted canonicalisation here. That
    // sounds circular and is not: the client verifies the signature itself
    // against a compiled-in key and is the only party whose trust decision
    // matters, because it is the only one that routes traffic. This function
    // re-validates to catch a malformed or drifted document, and structural
    // validation is all that requires.
    //
    // So verification on this path is defence in depth, and runs only when the
    // public key is configured. Making it mandatory would mean an unset or
    // mistyped var turns every policy fetch into a 503 for the whole fleet, and
    // trades a real outage for a check the client already performs. When the key
    // *is* present a bad signature means the stored row was altered underneath
    // us, which is worth refusing to serve.
    const publicKey = e.TRAFFIC_POLICY_PUBLIC_KEY;
    if (signature && publicKey) {
      if (!await verifyTrafficPolicySignature(json, signature, publicKey)) {
        throw new Error('policy signature does not verify');
      }
    }
    // Re-validating on read catches tampering and digest drift, but for an
    // unsigned policy it also couples every fetch to the current allowlists: an
    // allowlist entry removed while the stored policy still uses it makes this
    // throw for every device. See the note on `allowedDirectSuffixes` before
    // narrowing anything.
    canonicalTrafficPolicy(JSON.parse(json), Boolean(signature));
    return {
      revision: Number(row.revision),
      json,
      sha256: digest,
      updatedAt: Number(row.updated_at),
      ...(signature ? { signature } : {}),
    };
  } catch {
    throw new ApiError(503, 'TRAFFIC_POLICY_UNAVAILABLE', 'Managed traffic policy is unavailable');
  }
}
