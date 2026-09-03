import { useEffect, useRef, useState } from 'react';
import { operationsApi, type HomeExitDto, type ProductAccountDto, type UserDetailDto, type UserDto } from '../../api';
import { useResource, type Live } from '../../hooks';
import { acceptIfCurrent, bindDetail } from '../../lib/bound-detail';
import { formatBytes, timestamp } from '../../lib/format';
import { personAccountLabel, personTelemetryLabel, type OpsPersonView } from '../../lib/ops-views';
import { Banner, Status, Drawer, DrawerSection, Field, Note, Skeleton, Stat, StatGrid, Unavailable } from '../../ui';
import { usePrivacy } from '../../privacy';
import { CustomerDiagnostics } from './CustomerDiagnostics';
import { CustomerOperations } from './CustomerOperations';
import { useAsk } from './ask';
import { useMutation } from './mutate';

/** Pages that never open the Claude tools can omit `pooled`; the picker then
 * just reports the pool as not ready while manual entry keeps working. */
const POOLED_FALLBACK: Live<ProductAccountDto[]> = {
  state: 'loading',
  reload: () => undefined,
  reloadNow: async () => [],
  refreshedAt: 0,
  stale: null,
  refreshing: false,
};

export function CustomerDrawer({
  person,
  pending = false,
  open,
  focus,
  publishedRevision,
  catalog,
  homes,
  pooled = POOLED_FALLBACK,
  onClose,
  onChanged,
}: {
  person: OpsPersonView | null;
  pending?: boolean;
  open: boolean;
  focus: string | null;
  publishedRevision: number | null;
  catalog: Live<{ yaml: string }>;
  homes: Live<HomeExitDto[]>;
  pooled?: Live<ProductAccountDto[]>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();

  if (!open) return null;
  if (!person) {
    if (pending) {
      return (
        <Drawer open title="客户资料" onClose={onClose}>
          <Skeleton label="正在加载客户和心跳" />
        </Drawer>
      );
    }
    return (
      <Drawer open title="找不到这个客户" onClose={onClose}>
        <Unavailable title="没有这个客户" detail="链接里的人已经不在当前客户和心跳列表里。" />
      </Drawer>
    );
  }

  const accountLabel = personAccountLabel(person) ?? personTelemetryLabel(person);

  return (
    <Drawer
      open
      title={privacy.email(person.email)}
      subtitle={person.user ? `${person.user.status} · ${accountLabel}` : accountLabel}
      onClose={onClose}
    >
      <section className="drawer-section drawer-hero">
        <div className="drawer-hero-top">
          <span className={`nc-state nc-tone-${person.online ? 'ok' : 'unknown'}`}>
            <span className={`nc-dot nc-dot-${person.online ? 'ok' : 'unknown'}`} aria-hidden />
            {accountLabel}
          </span>
          {person.accountState === 'present' && person.user && <Status value={person.user.status} />}
          {person.expired && <span className="expired-flag">已过期</span>}
          {person.accountState === 'loading' && <span className="chip chip-unknown">客户资料加载中</span>}
          {person.accountState === 'unavailable' && <span className="chip chip-unknown">客户资料不可用</span>}
          {person.accountState === 'absent' && <span className="chip chip-unknown">心跳身份未进入客户库</span>}
        </div>
        <StatGrid columns={2}>
          <Stat label="当前节点" value={person.selectedServer ?? '未选节点'} />
          <Stat
            label="本期用量"
            value={`${formatBytes(person.usageBytes)}${person.quotaBytes == null ? ' / 不限' : ` / ${formatBytes(person.quotaBytes)}`}`}
            tone={person.quotaRatio == null ? undefined : person.quotaRatio >= 1 ? 'severe' : person.quotaRatio >= 0.8 ? 'warn' : undefined}
          />
        </StatGrid>
        {person.user?.contact && <p className="field-hint">联系 {privacy.secret(person.user.contact)}</p>}
      </section>

      <CustomerDiagnostics person={person} publishedRevision={publishedRevision} />

      {person.accountState === 'present' && person.user ? (
        <CustomerAccountBody
          key={person.user.id}
          userId={person.user.id}
          person={person}
          focus={focus}
          catalog={catalog}
          homes={homes}
          pooled={pooled}
          onChanged={onChanged}
        />
      ) : person.accountState === 'loading' ? (
        <Skeleton label="客户资料加载中，还不能做账户操作" />
      ) : person.accountState === 'unavailable' ? (
        <Unavailable title="客户资料不可用" detail="不能做开通、家宽、Claude 或注销。" />
      ) : (
        <Unavailable title="只有心跳、没有客户档案" detail="不能做开通、家宽、Claude 或注销。等这个身份进入客户库。" />
      )}
    </Drawer>
  );
}

function CustomerAccountBody({
  userId,
  person,
  focus,
  catalog,
  homes,
  pooled,
  onChanged,
}: {
  userId: string;
  person: OpsPersonView;
  focus: string | null;
  catalog: Live<{ yaml: string }>;
  homes: Live<HomeExitDto[]>;
  pooled: Live<ProductAccountDto[]>;
  onChanged: () => void;
}) {
  const user = person.user!;
  const privacy = usePrivacy();
  const ask = useAsk();
  const danger = useMutation();
  const detail = useResource(
    () => operationsApi.userDetail(userId).then((data) => bindDetail(userId, data)),
    [userId],
    0,
    true,
  );
  const bound = detail.state === 'ready' ? acceptIfCurrent(userId, detail.data.userId, detail.data) : null;
  const detailPending = bound == null && detail.state !== 'error';
  const [devicesOpen, setDevicesOpen] = useState(false);
  const devicesMark = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // DrawerSection owns the <details>; watch its toggle so device action
    // history is only fetched while the fold is actually open.
    const details = devicesMark.current?.closest('details');
    if (!details) return undefined;
    const sync = () => setDevicesOpen(details.open);
    sync();
    details.addEventListener('toggle', sync);
    return () => details.removeEventListener('toggle', sync);
  }, []);

  return (
    <>
      <CustomerOperations
        user={user}
        detail={bound}
        detailPending={detailPending}
        homes={homes}
        pooled={pooled}
        catalog={catalog}
        focus={focus}
        onChanged={() => { detail.reload(); onChanged(); }}
      />

      <ContactSection user={user} onChanged={onChanged} />

      <DrawerSection title="设备" fold aside={bound ? `${bound.devices.length} 台` : undefined}>
        <div ref={devicesMark} hidden />
        {detail.state === 'loading' || (detail.state === 'ready' && !bound) ? <Skeleton label="加载设备" /> : null}
        {detail.state === 'error' && <Unavailable title="设备没加载上来" detail={detail.message} />}
        {bound && (bound.devices.length === 0 ? <Note>还没有设备。</Note> : (
          <div className="device-list">
            {bound.devices.map((device) => (
              <article className="device-card" key={device.id}>
                <div className="device-card-top">
                  <strong>{device.name}</strong>
                  <Status value={device.status} />
                  <span className="field-hint">{timestamp(device.updatedAt)}</span>
                </div>
                {device.status !== 'revoked' && (
                  <DeviceButtons
                    deviceId={device.id}
                    active={devicesOpen}
                    onChanged={() => { detail.reload(); onChanged(); }}
                  />
                )}
              </article>
            ))}
          </div>
        ))}
      </DrawerSection>

      <DrawerSection title="诊断报告" fold aside={bound ? `${bound.diagnostics.length} 份` : undefined}>
        {detail.state === 'loading' || (detail.state === 'ready' && !bound) ? <Skeleton label="加载诊断报告" /> : null}
        {detail.state === 'error' && <Unavailable title="诊断报告没加载上来" detail={detail.message} />}
        {bound && bound.diagnostics.length === 0 && <Note>还没有诊断报告。</Note>}
        {bound && bound.diagnostics.map((report) => (
          <DiagnosticReport key={report.referenceCode} report={report} />
        ))}
      </DrawerSection>

      <DrawerSection title="危险操作" danger>
        <Note tone="severe">
          {user.status === 'active'
            ? '注销会立刻断登录、撤销设备、把家宽退回库存。'
            : '恢复后这个账号可以再登录。'}
        </Note>
        {ask.dialog}
        <Banner message={danger.ok} tone="ok" />
        <Banner message={danger.error} tone="error" />
        <button
          type="button"
          className={user.status === 'active' ? 'btn btn-outline btn-danger' : 'btn btn-outline'}
          disabled={danger.busy || ask.busy}
          onClick={() => ask.prompt(
            user.status === 'active' ? `注销 ${privacy.email(user.email)}？` : `恢复 ${privacy.email(user.email)}？`,
            user.status === 'active'
              ? '马上不能登录，设备会撤销，家宽会退回库存。确认后才会执行。'
              : '恢复后可以再登录。确认后才会改状态。',
            async () => {
              if (user.status === 'active') await operationsApi.closeUser(user.id);
              else await operationsApi.setUserStatus(user.id, 'active');
              onChanged();
            },
          )}
        >{user.status === 'active' ? '注销账号' : '恢复账号'}</button>
      </DrawerSection>
    </>
  );
}

function ContactSection({ user, onChanged }: { user: UserDto; onChanged: () => void }) {
  const privacy = usePrivacy();
  const save = useMutation();
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState(user.contact ?? '');
  const [notes, setNotes] = useState(user.notes ?? '');
  return (
    <DrawerSection title="联系与备注" fold aside={user.contact ? privacy.secret(user.contact) : '未填'}>
      <Banner message={save.ok} tone="ok" />
      <Banner message={save.error} tone="error" />
      {editing ? (
        <div className="stack home-form">
          <Field label="微信或备注联系方式">
            <input className="input compact sensitive-value" value={contact} onChange={(event) => setContact(event.target.value)} disabled={save.busy} />
          </Field>
          <Field label="备注">
            <input className="input compact" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={save.busy} />
          </Field>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={save.busy}
              onClick={() => void save.run(async () => {
                await operationsApi.patchUser(user.id, {
                  contact: contact.trim() || null,
                  notes: notes.trim() || null,
                });
                setEditing(false);
                onChanged();
              }, '已保存联系和备注')}
            >保存</button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={save.busy}
              onClick={() => {
                setContact(user.contact ?? '');
                setNotes(user.notes ?? '');
                setEditing(false);
              }}
            >取消</button>
          </div>
        </div>
      ) : (
        <div className="stack home-form">
          <p className="field-hint">联系 {user.contact ? privacy.secret(user.contact) : '未填'}</p>
          <p className="field-hint">备注 {user.notes || '未填'}</p>
          <button
            type="button"
            className="btn btn-outline btn-sm home-action"
            disabled={save.busy}
            onClick={() => {
              setContact(user.contact ?? '');
              setNotes(user.notes ?? '');
              setEditing(true);
            }}
          >编辑</button>
        </div>
      )}
    </DrawerSection>
  );
}

function DiagnosticReport({ report }: { report: UserDetailDto['diagnostics'][number] }) {
  const privacy = usePrivacy();
  return (
    <details className="raw-fold">
      <summary>
        <code>{report.referenceCode}</code>
        {' · '}
        {timestamp(report.receivedAt)}
        {' · '}
        {report.clientVersion} / {report.osVersion}
      </summary>
      {privacy.privacy
        ? <Note>隐私模式已隐藏原始诊断 JSON。</Note>
        : <pre className="report-json">{prettyReport(report.reportJson)}</pre>}
    </details>
  );
}

function prettyReport(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function DeviceButtons({
  deviceId,
  active,
  onChanged,
}: {
  deviceId: string;
  active: boolean;
  onChanged: () => void;
}) {
  const ask = useAsk();
  const action = useMutation();
  const actions = useResource(() => operationsApi.deviceActions(deviceId), [deviceId], 0, active);
  const last = actions.state === 'ready' ? actions.data[0] : undefined;
  async function run(next: string, success: string) {
    await action.run(async () => {
      await operationsApi.enqueueDeviceAction(deviceId, next);
      actions.reload();
      onChanged();
    }, success);
  }
  return (
    <div className="device-actions">
      {ask.dialog}
      <Banner message={action.ok} tone="ok" />
      <Banner message={action.error} tone="error" />
      {last && <small className="muted">最近动作 {last.action} · {last.status}</small>}
      <div className="row-actions">
        <button type="button" className="btn btn-outline btn-sm" disabled={action.busy || ask.busy} onClick={() => void run('diagnostic_snapshot', '已发出诊断')}>诊断</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={action.busy || ask.busy} onClick={() => void run('claude_traffic_snapshot', '已发出快照')}>流量快照</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={action.busy || ask.busy} onClick={() => void run('refresh_catalog', '已发出刷新')}>刷新节点</button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={action.busy || ask.busy}
          onClick={() => ask.prompt(
            '只在这台已经断线保护时再试一次？',
            '正常连着的不会被断开。确认后才会下发。',
            () => run('retry_protection', '已发出重试'),
          )}
        >重试断线保护</button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={action.busy || ask.busy}
          onClick={() => ask.prompt(
            '撤销这台设备并踢下线？',
            '这台设备的登录会被作废。确认后才会执行。',
            async () => {
              await operationsApi.revokeDevice(deviceId);
              actions.reload();
              onChanged();
              action.setOk('已撤销');
            },
          )}
        >撤销</button>
      </div>
    </div>
  );
}
