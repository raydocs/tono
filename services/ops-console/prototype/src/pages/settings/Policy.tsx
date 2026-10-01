import { useState } from 'react';
import { Button, Dot, Panel } from '@proto/ds';
import { Field, Textarea } from '@proto/ds/forms';
import { Confirm, Diff, Drawer, KV, Section } from '@proto/ds/overlay';

const CURRENT = {
  revision: 4,
  webDirect: { enabled: false, domains: [] as string[] },
  nativeDirect: { enabled: true, apps: 38 },
  tcpEndpoints: { enabled: true, count: 12 },
};

type Check = { ok: boolean; error: string | null; value: typeof CURRENT | null };

function check(text: string): Check {
  try {
    const v = JSON.parse(text) as typeof CURRENT;
    if (typeof v.revision !== 'number') return { ok: false, error: '缺少 revision（数字）', value: null };
    if (!v.webDirect || typeof v.webDirect.enabled !== 'boolean') return { ok: false, error: 'webDirect.enabled 必须是 true / false', value: null };
    if (!Array.isArray(v.webDirect.domains)) return { ok: false, error: 'webDirect.domains 必须是数组', value: null };
    const bad = v.webDirect.domains.find((d) => typeof d !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
    if (bad !== undefined) return { ok: false, error: `域名不合法：${String(bad)}`, value: null };
    return { ok: true, error: null, value: v };
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${(e as Error).message}`, value: null };
  }
}

export function Policy() {
  const [live, setLive] = useState(CURRENT);
  const [editor, setEditor] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [publish, setPublish] = useState(false);
  const [kill, setKill] = useState<'web' | 'all' | null>(null);
  const draft = { ...live, revision: live.revision + 1, webDirect: { enabled: true, domains: ['bilibili.com', 'qq.com'] } };
  const result = check(text);
  const next = result.value;
  const diff = next ? [
    { field: 'revision', before: `r${live.revision}`, after: `r${next.revision}` },
    ...(next.webDirect.enabled !== live.webDirect.enabled ? [{ field: 'webDirect.enabled', before: String(live.webDirect.enabled), after: String(next.webDirect.enabled) }] : []),
    ...(next.webDirect.domains.length !== live.webDirect.domains.length ? [{ field: 'webDirect.domains', before: String(live.webDirect.domains.length), after: `${next.webDirect.domains.length}（${next.webDirect.domains.join('、')}）` }] : []),
  ] : [];
  return (
    <div className="flex flex-col gap-4">
      <Panel title={`当前规则 r${live.revision}`} description="签名后下发；保存前先预演，看有多少客户端会重连" source="managed_traffic_policy">
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          {[['网页直连', `${live.webDirect.domains.length} 个域名`, live.webDirect.enabled ? '开启' : '已关闭'], ['原生应用直连', `${live.nativeDirect.apps} 个`, live.nativeDirect.enabled ? '开启' : '已关闭'], ['TCP 端点', `${live.tcpEndpoints.count} 个`, live.tcpEndpoints.enabled ? '开启' : '已关闭']].map(([k, v, s]) => (
            <div key={k} className="rounded-md border border-line px-3 py-2.5"><div className="text-muted">{k}</div><div className="mt-0.5 font-medium num">{v}</div><div className="text-xs text-faint">{s}</div></div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => { setText(JSON.stringify(draft, null, 2)); setPreview(false); setEditor(true); }}>编辑 JSON</Button>
          <span className="flex-1" />
          <Button variant="danger" onClick={() => setKill('web')} disabled={!live.webDirect.enabled}>关闭网页直连</Button>
          <Button variant="danger" onClick={() => setKill('all')}>关掉全部直连</Button>
        </div>
        <p className="mt-2 text-xs text-muted">两个红色按钮是止血开关：只会让更多流量进隧道，不会让任何流量绕开，所以不需要预演。</p>
      </Panel>

      <Drawer open={editor} onOpenChange={setEditor} wide title={`编辑分流规则 · 草稿 r${live.revision + 1}`} subtitle="改完先预演；预演通过才能发布。"
        footer={<><Button onClick={() => setEditor(false)}>取消</Button><Button disabled={!result.ok} onClick={() => setPreview(true)}>预演</Button><Button variant="primary" disabled={!result.ok || !preview} onClick={() => setPublish(true)}>发布</Button></>}>
        <Field label="policy.json" error={result.error} hint="语法和字段在输入时校验。">
          <Textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(false); }} rows={14} spellCheck={false} className="num text-xs leading-5" />
        </Field>
        {result.ok && <div className="mt-6"><Section title="改了什么"><Diff rows={diff} /></Section></div>}
        {preview && result.ok && (
          <Section title="预演结果">
            <div className="rounded-md border border-line bg-panel-2 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Dot tone="ok" />可以发布</div>
              <KV rows={[['会重连的客户端', '51 台（规则变化都会触发一次重连）'], ['新增直连流量', '约 2.7 GB/天，来自 bilibili.com、qq.com'], ['泄露检查', '直连域名全部在大陆 CDN，没有境外 IP'], ['签名', '用 POLICY_SIGNING_KEY 签，客户端验签失败会保留旧规则']]} />
            </div>
          </Section>
        )}
      </Drawer>

      <Confirm open={publish} onOpenChange={setPublish} title={`发布分流规则 r${live.revision + 1}`} action="发布"
        description="客户端下次心跳拉到新规则并重连一次。如果这期间有人发布了新版本，会被拒绝并保留草稿。"
        impact={<Diff rows={diff} />}
        steps={['签名', '写入 managed_traffic_policy', '通知客户端']} doneText={`分流规则 r${live.revision + 1} 已发布`}
        onDone={() => { if (next) setLive(next); setEditor(false); }} />

      <Confirm open={kill !== null} onOpenChange={(v) => { if (!v) setKill(null); }} tone="danger" title={kill === 'all' ? '关掉全部直连' : '关闭网页直连'} action="立即关闭"
        description={kill === 'all' ? '网页、原生应用、TCP 端点三类直连全部关闭，所有流量走隧道。国内站点会变慢。' : '网页直连域名清空，这些站点改走隧道。原生应用和 TCP 端点不变。'}
        steps={['生成规则 r' + (live.revision + 1), '签名并发布', '通知客户端']} doneText="直连已关闭"
        onDone={() => setLive({ ...live, revision: live.revision + 1, webDirect: { enabled: false, domains: [] }, ...(kill === 'all' ? { nativeDirect: { ...live.nativeDirect, enabled: false }, tcpEndpoints: { ...live.tcpEndpoints, enabled: false } } : {}) })} />
    </div>
  );
}
