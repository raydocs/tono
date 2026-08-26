import { useEffect, useState, type FormEvent } from 'react';
import { operationsApi, type HomeExitDto, type ProductAccountDto } from '../../api';
import type { Live } from '../../hooks';
import { Drawer, Banner, Field, FieldGrid, Note, Skeleton, Unavailable } from '../../ui';
import { usePrivacy } from '../../privacy';
import { useMutation } from './mutate';

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

function emptyExtras() {
  return { line: '', homeExitId: '', accountRef: '', productAccountId: '', contact: '' };
}

export function OnboardDrawer({
  open,
  homes,
  pooled,
  onClose,
  onDone,
}: {
  open: boolean;
  homes: Live<HomeExitDto[]>;
  pooled: Live<ProductAccountDto[]>;
  onClose: () => void;
  onDone: () => void;
}) {
  const privacy = usePrivacy();
  const mutate = useMutation();
  const [email, setEmail] = useState('');
  const [extras, setExtras] = useState(emptyExtras);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const unusedHomes = homes.state === 'ready'
    ? homes.data.filter((home) => home.status === 'active' && (home.bindCount ?? 0) === 0)
    : [];
  const pooledRows = pooled.state === 'ready' ? pooled.data : [];

  useEffect(() => {
    if (open) return;
    setEmail('');
    setExtras(emptyExtras());
    setResult(null);
    setError(null);
  }, [open]);

  function changeEmail(value: string) {
    setEmail(value);
    setResult(null);
    setExtras(emptyExtras());
  }

  async function submit(event: FormEvent, withExtras: boolean) {
    event.preventDefault();
    setError(null);
    await mutate.run(async () => {
      const response = await operationsApi.onboardUser({
        email: email.trim(),
        line: withExtras && extras.line.trim() ? extras.line.trim() : undefined,
        homeExitId: withExtras && extras.homeExitId ? extras.homeExitId : undefined,
        accountRef: withExtras && extras.accountRef.trim() ? extras.accountRef.trim() : undefined,
        productAccountId: withExtras && extras.productAccountId ? extras.productAccountId : undefined,
        contact: withExtras && extras.contact.trim() ? extras.contact.trim() : undefined,
      });
      const extrasOffered = withExtras && Boolean(
        extras.line.trim() || extras.homeExitId || extras.accountRef.trim() || extras.productAccountId || extras.contact.trim(),
      );
      setResult({
        email: response.email,
        allowlisted: response.allowlisted,
        registered: response.userId != null,
        exitIdentityIssued: Boolean(response.exitIdentityIssued),
        hasHome: response.binding != null,
        hasClaude: response.account != null,
        extrasIgnored: extrasOffered && response.userId == null,
      });
      if (withExtras && response.userId) setExtras(emptyExtras());
      onDone();
    });
  }

  const waiting = result && !result.registered;

  return (
    <Drawer open={open} title="开通客户" subtitle="先让客户能登录，再绑家宽和 Claude" onClose={onClose}>
      <Banner message={error || mutate.error} tone="error" />
      <form className="onboard-steps" onSubmit={(event) => void submit(event, Boolean(result?.registered))}>
        <Field label="客户邮箱" hint="用来收验证码的邮箱">
          <input className="input" type="email" required value={email} onChange={(event) => changeEmail(event.target.value)} disabled={mutate.busy} />
        </Field>
        {!result && (
          <button className="btn" type="submit" disabled={mutate.busy || !email.trim()}>{mutate.busy ? '保存中…' : '保存登录资格'}</button>
        )}
        {waiting && (
          <div className="onboard-result">
            <strong className="onboard-subject">{privacy.email(result.email)}</strong>
            <OnboardChecklist result={result} />
            <Note tone="info">请客户先在 App 里用这个邮箱收验证码登录。登录完成后再点一次保存，才会收集家宽和 Claude。</Note>
            <div className="row-actions">
              <button className="btn" type="submit" disabled={mutate.busy}>我已经登录，再检查一次</button>
            </div>
          </div>
        )}
        {result?.registered && (
          <div className="onboard-result">
            <strong className="onboard-subject">{privacy.email(result.email)}</strong>
            <OnboardChecklist result={result} />
            {homes.state === 'loading' && <Skeleton label="家宽库存" />}
            {homes.state === 'error' && <Unavailable title="家宽库存不可用" detail={homes.message} />}
            {pooled.state === 'loading' && <Skeleton label="号池" />}
            {pooled.state === 'error' && <Unavailable title="号池不可用" detail={pooled.message} />}
            <FieldGrid>
              <Field label="家宽" hint="直接贴一行 host:port:user:pass">
                <input
                  className="input"
                  value={extras.line}
                  onChange={(event) => setExtras({ ...extras, line: event.target.value, homeExitId: event.target.value ? '' : extras.homeExitId })}
                  placeholder="host:port:user:pass"
                  disabled={mutate.busy}
                  spellCheck={false}
                />
              </Field>
              <Field label="或从库存里选">
                <select
                  className="input"
                  value={extras.homeExitId}
                  onChange={(event) => setExtras({ ...extras, homeExitId: event.target.value, line: event.target.value ? '' : extras.line })}
                  disabled={mutate.busy || homes.state !== 'ready'}
                >
                  <option value="">{homes.state !== 'ready' ? '库存未就绪' : unusedHomes.length ? '先不选' : '库存是空的'}</option>
                  {unusedHomes.map((home) => (
                    <option key={home.id} value={home.id}>{home.displayName} · {privacy.ip(home.socks5Host)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Claude 账号">
                <input
                  className="input"
                  value={extras.accountRef}
                  onChange={(event) => setExtras({ ...extras, accountRef: event.target.value, productAccountId: event.target.value ? '' : extras.productAccountId })}
                  disabled={mutate.busy}
                />
              </Field>
              <Field label="或从号池里选">
                <select
                  className="input"
                  value={extras.productAccountId}
                  onChange={(event) => setExtras({ ...extras, productAccountId: event.target.value, accountRef: event.target.value ? '' : extras.accountRef })}
                  disabled={mutate.busy || pooled.state !== 'ready'}
                >
                  <option value="">{pooled.state !== 'ready' ? '号池未就绪' : pooledRows.length ? '先不选' : '号池是空的'}</option>
                  {pooledRows.map((account) => (
                    <option key={account.id} value={account.id}>{privacy.secret(account.accountRef)}</option>
                  ))}
                </select>
              </Field>
              <Field label="微信或备注">
                <input className="input" value={extras.contact} onChange={(event) => setExtras({ ...extras, contact: event.target.value })} disabled={mutate.busy} />
              </Field>
            </FieldGrid>
            <div className="row-actions">
              <button className="btn" type="submit" disabled={mutate.busy}>保存家宽 / Claude</button>
            </div>
          </div>
        )}
      </form>
    </Drawer>
  );
}
