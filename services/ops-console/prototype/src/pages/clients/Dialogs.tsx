import { useState } from 'react';
import { Button } from '@proto/ds';
import { Field, Input, Select, Textarea } from '@proto/ds/forms';
import { Confirm, Drawer, KV, useToast } from '@proto/ds/overlay';
import type { RELEASES } from '@proto/mock/business';

type Release = (typeof RELEASES)[number];

export function VerifyConfirm({ r, onClose }: { r: Release | null; onClose: () => void }) {
  return (
    <Confirm open={!!r} onOpenChange={(v) => { if (!v) onClose(); }} title={r ? `校验并发布 ${r.platform} ${r.version}` : ''} action="校验并发布"
      description="先逐项校验 R2 里的安装包，任何一项不一致就停下，不写通道。"
      impact={r && <KV rows={[['通道', '内测 → 正式'], ['R2 对象', `releases/${r.platform.toLowerCase()}/${r.version}/Tono-${r.version}.${r.platform === 'macOS' ? 'dmg' : 'msi'}`], ['覆盖', '下次检查更新时 20 台 Windows 设备会看到']]} />}
      steps={['读取 R2 对象', '比对大小', '比对 sha256', '签名校验', '写入正式通道']} doneText={r ? `${r.platform} ${r.version} 已发布到正式通道` : ''} />
  );
}

export function RevokeConfirm({ r, onClose }: { r: Release | null; onClose: () => void }) {
  return (
    <Confirm open={!!r} onOpenChange={(v) => { if (!v) onClose(); }} tone="danger" title={r ? `撤回 ${r.platform} ${r.version}` : ''} action="撤回" typed={r?.version}
      description="撤回后新设备不再收到这个版本；已经装了的设备不会被降级。"
      impact={r && <ul className="flex flex-col gap-1"><li>{r.users} 台设备在用，会被提示升级到当前最新正式版</li><li>{r.floor ? '它是最低支持版本；撤回会把最低支持抬到下一个版本' : '最低支持版本不变'}</li><li>R2 里的文件保留，可以重新发布</li></ul>}
      steps={['从正式通道移除', '更新 latest 指针', '写审计']} doneText={r ? `已撤回 ${r.version}` : ''} />
  );
}

export function RegisterDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const toast = useToast();
  const [platform, setPlatform] = useState('Windows');
  const [version, setVersion] = useState('');
  const [sha, setSha] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const vError = !/^\d+\.\d+\.\d+$/.test(version) ? '写成 1.5.2 这种格式' : null;
  const shaError = !/^[0-9a-f]{64}$/.test(sha) ? '64 位小写十六进制' : null;
  const valid = !vError && !shaError;
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="登记新版本" subtitle="登记进内测通道。发布到正式前还要再校验一次 R2 里的文件。"
      footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" disabled={touched && !valid} onClick={() => { setTouched(true); if (valid) { onOpenChange(false); toast(`${platform} ${version} 已登记到内测`, 'ok'); } }}>登记到内测</Button></>}>
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="平台" required><Select value={platform} onChange={(e) => setPlatform(e.target.value)} options={[{ value: 'macOS', label: 'macOS' }, { value: 'Windows', label: 'Windows' }]} /></Field>
          <Field label="版本" required error={touched ? vError : null}><Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.5.2" className="num" /></Field>
        </div>
        <Field label="sha256" required error={touched ? shaError : null} hint="CI 产物页上的值；发布时会和 R2 对象比对。">
          <Input value={sha} onChange={(e) => setSha(e.target.value.trim())} className="num text-xs" placeholder="9f3a…" />
        </Field>
        <Field label="更新说明" hint="客户端里展示给客户，中文，两三行。"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></Field>
      </form>
    </Drawer>
  );
}
