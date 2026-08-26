import { useState } from 'react';
import { operationsApi, type HomeExitDto, type UserDetailDto } from '../../api';
import { useResource } from '../../hooks';
import { formatBytes, timestamp } from '../../lib/format';
import type { OpsPersonView } from '../../lib/ops-views';
import { Status, Drawer, Skeleton, Unavailable } from '../../ui';
import { usePrivacy } from '../../privacy';
import { CustomerDiagnostics } from './CustomerDiagnostics';
import { CustomerOperations } from './CustomerOperations';
import { useAsk } from './ask';

export function CustomerDrawer({
  person,
  open,
  focus,
  publishedRevision,
  catalogYaml,
  homes,
  onClose,
  onChanged,
}: {
  person: OpsPersonView | null;
  open: boolean;
  focus: string | null;
  publishedRevision: number | null;
  catalogYaml: string | null;
  homes: HomeExitDto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk();
  const enabled = Boolean(person?.user);
  const detail = useResource<UserDetailDto>(
    () => operationsApi.userDetail(person!.user!.id),
    [person?.user?.id],
    0,
    enabled && Boolean(person?.user),
  );

  if (!open) return null;
  if (!person) {
    return (
      <Drawer open title="找不到这个客户" onClose={onClose}>
        <Unavailable title="没有这个客户" detail="链接里的人已经不在当前客户和心跳列表里。" />
      </Drawer>
    );
  }
  const user = person.user;

  return (
    <Drawer
      open
      title={privacy.email(person.email)}
      subtitle={user ? `${user.status} · ${person.online ? `${person.onlineDeviceCount} 台在线` : person.telemetryState === 'unreported' ? '未上报' : person.telemetryState === 'unavailable' ? '心跳不可用' : '离线'}` : '心跳身份未进入客户库'}
      onClose={onClose}
    >
      {ask.dialog}
      <section className="drawer-section">
        <div className="person-tags">
          {user ? <Status value={user.status} /> : <span className="chip chip-muted">无账户</span>}
          {person.expired && <span className="expired-flag">已过期</span>}
        </div>
        <p>
          {person.selectedServer ?? '未选节点'} · 用量 {formatBytes(person.usageBytes)}
          {person.quotaBytes == null ? ' / 不限' : ` / ${formatBytes(person.quotaBytes)}`}
        </p>
        {user?.contact && <p className="muted">联系 {privacy.secret(user.contact)}</p>}
      </section>

      <CustomerDiagnostics person={person} publishedRevision={publishedRevision} />

      {user ? (
        <>
          <CustomerOperations
            user={user}
            detail={detail.state === 'ready' ? detail.data : null}
            homes={homes}
            catalogYaml={catalogYaml}
            focus={focus}
            onChanged={() => { detail.reload(); onChanged(); }}
          />

          <section className="drawer-section">
            <h3>设备</h3>
            {detail.state === 'loading' && <Skeleton label="加载设备" />}
            {detail.state === 'error' && <Unavailable title="设备没加载上来" detail={detail.message} />}
            {detail.state === 'ready' && (detail.data.devices.length === 0 ? <p className="muted">还没有设备</p> : (
              <ul className="detail-list">
                {detail.data.devices.map((device) => (
                  <li key={device.id}>
                    <Status value={device.status} />
                    <strong>{device.name}</strong>
                    <span className="muted">{timestamp(device.updatedAt)}</span>
                    {device.status !== 'revoked' && (
                      <DeviceButtons deviceId={device.id} onChanged={() => { detail.reload(); onChanged(); }} />
                    )}
                  </li>
                ))}
              </ul>
            ))}
          </section>

          <section className="drawer-section">
            <h3>诊断报告</h3>
            {detail.state === 'ready' && detail.data.diagnostics.length === 0 && <p className="muted">还没有诊断报告</p>}
            {detail.state === 'ready' && detail.data.diagnostics.map((report) => (
              <details key={report.referenceCode}>
                <summary><code>{report.referenceCode}</code> · {timestamp(report.receivedAt)}</summary>
                {privacy.privacy
                  ? <p className="muted">隐私模式已隐藏原始诊断 JSON。</p>
                  : <pre className="report-json">{prettyReport(report.reportJson)}</pre>}
              </details>
            ))}
          </section>

          <section className="danger-zone">
            <h3>危险操作</h3>
            <button
              type="button"
              className="btn"
              onClick={() => ask.prompt(
                user.status === 'active' ? `注销 ${privacy.email(user.email)}？` : `恢复 ${privacy.email(user.email)}？`,
                user.status === 'active'
                  ? '马上不能登录，设备会撤销，家宽会退回库存。确认后才会执行。'
                  : '恢复后可以再登录。确认后才会改状态。',
                () => (user.status === 'active' ? operationsApi.closeUser(user.id) : operationsApi.setUserStatus(user.id, 'active'))
                  .then(() => onChanged()),
              )}
            >{user.status === 'active' ? '注销账号' : '恢复账号'}</button>
          </section>
        </>
      ) : (
        <Unavailable title="只有心跳、没有客户档案" detail="不能做开通、家宽、Claude 或注销。等这个身份进入客户库。" />
      )}
    </Drawer>
  );
}

function prettyReport(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function DeviceButtons({ deviceId, onChanged }: { deviceId: string; onChanged: () => void }) {
  const ask = useAsk();
  const [message, setMessage] = useState<string | null>(null);
  async function run(action: string) {
    await operationsApi.enqueueDeviceAction(deviceId, action);
    setMessage('已发出');
    onChanged();
  }
  return (
    <div className="device-actions">
      {ask.dialog}
      <div className="row-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => run('diagnostic_snapshot')}>诊断</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => run('claude_traffic_snapshot')}>流量快照</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => run('refresh_catalog')}>刷新节点</button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => ask.prompt(
            '只在这台已经断线保护时再试一次？',
            '正常连着的不会被断开。确认后才会下发。',
            () => run('retry_protection'),
          )}
        >重试断线保护</button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => ask.prompt(
            '撤销这台设备并踢下线？',
            '这台设备的登录会被作废。确认后才会执行。',
            () => operationsApi.revokeDevice(deviceId).then(onChanged),
          )}
        >撤销</button>
      </div>
      {message && <div className="muted">{message}</div>}
    </div>
  );
}
