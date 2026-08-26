import { useState, type FormEvent } from 'react';
import { operationsApi, type HomeExitDto, type ProductAccountDto } from '../../api';
import { Drawer, Banner } from '../../ui';
import { usePrivacy } from '../../privacy';

type OnboardResult = {
  email: string;
  allowlisted: boolean;
  registered: boolean;
  exitIdentityIssued: boolean;
  hasHome: boolean;
  hasClaude: boolean;
  extrasIgnored: boolean;
};

export function OnboardChecklist({ result }: { result: OnboardResult }) {
  const rows: Array<{ ok: boolean; text: string }> = [
    { ok: result.allowlisted, text: '可以用这个邮箱登录' },
    {
      ok: result.registered,
      text: result.registered ? '已经在 App 里注册过' : '还没注册，用这个邮箱在 App 里收验证码就行',
    },
    {
      ok: result.exitIdentityIssued,
      text: result.exitIdentityIssued
        ? '连接凭证已生成。还要同步到服务器，同步停了就连不上'
        : '连接凭证还没生成，等客户登录后再点一次保存',
    },
    { ok: result.hasHome, text: result.hasHome ? '已绑定家宽' : '还没绑定家宽（可选）' },
    { ok: result.hasClaude, text: result.hasClaude ? '已开通 Claude' : '还没开通 Claude（可选）' },
  ];
  if (result.extrasIgnored) {
    rows.push({ ok: false, text: '这次填的家宽和 Claude 没保存，等客户登录后再点一次' });
  }
  return (
    <ul className="onboard-check">
      {rows.map((row) => (
        <li key={row.text} className={row.ok ? 'ok' : 'wait'}>
          <span aria-hidden>{row.ok ? '✓' : '○'}</span>
          {row.text}
        </li>
      ))}
    </ul>
  );
}

export function OnboardDrawer({
  open,
  homes,
  pooled,
  onClose,
  onDone,
}: {
  open: boolean;
  homes: HomeExitDto[];
  pooled: ProductAccountDto[];
  onClose: () => void;
  onDone: () => void;
}) {
  const privacy = usePrivacy();
  const [email, setEmail] = useState('');
  const [line, setLine] = useState('');
  const [homeExitId, setHomeExitId] = useState('');
  const [accountRef, setAccountRef] = useState('');
  const [productAccountId, setProductAccountId] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const unusedHomes = homes.filter((home) => home.status === 'active' && (home.bindCount ?? 0) === 0);

  async function submit(event: FormEvent, withExtras: boolean) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await operationsApi.onboardUser({
        email: email.trim(),
        line: withExtras ? (line.trim() || undefined) : undefined,
        homeExitId: withExtras ? (homeExitId || undefined) : undefined,
        accountRef: withExtras ? (accountRef.trim() || undefined) : undefined,
        productAccountId: withExtras ? (productAccountId || undefined) : undefined,
        contact: withExtras ? (contact.trim() || undefined) : undefined,
      });
      const extrasOffered = withExtras && Boolean(line.trim() || homeExitId || accountRef.trim() || productAccountId || contact.trim());
      setResult({
        email: response.email,
        allowlisted: response.allowlisted,
        registered: response.userId != null,
        exitIdentityIssued: Boolean(response.exitIdentityIssued),
        hasHome: response.binding != null,
        hasClaude: response.account != null,
        extrasIgnored: extrasOffered && response.userId == null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  const waiting = result && !result.registered;

  return (
    <Drawer open={open} title="开通客户" subtitle="先让客户能登录，再绑家宽和 Claude" onClose={onClose}>
      <Banner message={error} tone="error" />
      <form className="onboard-steps" onSubmit={(event) => submit(event, Boolean(result?.registered))}>
        <label>
          <span>客户邮箱</span>
          <input className="input" type="email" required value={email} onChange={(event) => { setEmail(event.target.value); setResult(null); }} placeholder="用来收验证码的邮箱" disabled={busy} />
        </label>
        {!result && (
          <button className="btn" type="submit" disabled={busy || !email.trim()}>{busy ? '保存中…' : '保存登录资格'}</button>
        )}
        {waiting && (
          <div className="onboard-result">
            <strong>{privacy.email(result.email)}</strong>
            <OnboardChecklist result={result} />
            <p>请客户先在 App 里用这个邮箱收验证码登录。登录完成后再点一次保存，才会收集家宽和 Claude。</p>
            <button className="btn" type="submit" disabled={busy}>我已经登录，再检查一次</button>
          </div>
        )}
        {result?.registered && (
          <div className="onboard-result">
            <strong>{privacy.email(result.email)}</strong>
            <OnboardChecklist result={result} />
            <div className="form-grid">
              <label>
                <span>家宽（直接贴过来）</span>
                <input className="input" value={line} onChange={(event) => setLine(event.target.value)} placeholder="host:port:user:pass" disabled={busy} spellCheck={false} />
              </label>
              <label>
                <span>或从库存里选</span>
                <select className="input" value={homeExitId} onChange={(event) => setHomeExitId(event.target.value)} disabled={busy || unusedHomes.length === 0}>
                  <option value="">{unusedHomes.length ? '先不选' : '库存是空的'}</option>
                  {unusedHomes.map((home) => (
                    <option key={home.id} value={home.id}>{home.displayName} · {privacy.ip(home.socks5Host)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Claude 账号</span>
                <input className="input" value={accountRef} onChange={(event) => setAccountRef(event.target.value)} disabled={busy} />
              </label>
              <label>
                <span>或从号池里选</span>
                <select className="input" value={productAccountId} onChange={(event) => setProductAccountId(event.target.value)} disabled={busy || pooled.length === 0}>
                  <option value="">{pooled.length ? '先不选' : '号池是空的'}</option>
                  {pooled.map((account) => (
                    <option key={account.id} value={account.id}>{privacy.secret(account.accountRef)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>微信或备注</span>
                <input className="input" value={contact} onChange={(event) => setContact(event.target.value)} disabled={busy} />
              </label>
            </div>
            <button className="btn" type="submit" disabled={busy}>保存家宽 / Claude</button>
          </div>
        )}
      </form>
    </Drawer>
  );
}
