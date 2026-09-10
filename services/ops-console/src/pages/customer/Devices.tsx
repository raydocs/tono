import { useState } from 'react';
import type { CustomerDeviceDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { customerApi } from '@/lib/api-customer-actions';
import { nowSec } from '@/lib/clock';
import { actionsFor, DEVICE_ACTIONS, deviceIsLive, logWindowEnd } from '@/lib/customers';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { useResource } from '@/lib/use-resource';
import type { DeviceAction, LogWindow } from '@/lib/customers-legacy';
import { useAsk, WriteError } from './ask';

type Standing = { last: DeviceAction | null; window: LogWindow };

/**
 * One card per device: what it is, what was last asked of it, and the six
 * things that can be asked.
 *
 * A table was the wrong shape once the buttons arrived. Six controls do not
 * fit a 130 px column, and the answer an operator wants beside them — what was
 * queued for this machine and whether it ever picked it up — is a sentence,
 * not a cell.
 *
 * Nothing here happens on the device now. The four actions are a queue: the
 * hub writes a row, the client collects it on its next check-in, and if it
 * never does the row expires five minutes later. That is why a button whose
 * platform has no handler is disabled rather than hopeful — an action nobody
 * will ever collect looks exactly like one that worked.
 */
export function Devices({
  userId,
  devices,
  onChanged,
}: {
  userId: string;
  devices: readonly CustomerDeviceDto[];
  onChanged: () => void;
}) {
  const live = devices.filter(deviceIsLive);
  const standing = useResource(
    live.length === 0 ? null : `${userId}#${String(live.length)}`,
    async (signal) => {
      const pairs = await Promise.all(live.map(async (device) => {
        const [actions, window] = await Promise.all([
          customerApi.deviceActions(device.id, signal),
          customerApi.logWindow(userId, device.id, signal),
        ]);
        return [device.id, { last: actions[0] ?? null, window }] as const;
      }));
      return new Map<string, Standing>(pairs);
    },
  );

  const rows = standing.status === 'ready' ? standing.data : new Map<string, Standing>();

  return (
    <Section title={copy.customerSections.devices}>
      {devices.length === 0 ? <Empty message={copy.noDevices} /> : null}
      {devices.map((device) => (
        <DeviceCard
          key={device.id}
          userId={userId}
          device={device}
          standing={rows.get(device.id) ?? null}
          loading={standing.status === 'loading'}
          onChanged={() => {
            standing.reload();
            onChanged();
          }}
        />
      ))}
    </Section>
  );
}

function DeviceCard({
  userId,
  device,
  standing,
  loading,
  onChanged,
}: {
  userId: string;
  device: CustomerDeviceDto;
  standing: Standing | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const ask = useAsk(onChanged);
  const [revoking, setRevoking] = useState(false);
  const allowed = actionsFor(device.platform);
  const gone = !deviceIsLive(device);
  const platformWord = device.platform === null ? copy.missing : copy.platform[device.platform];
  const blocked = gone
    ? copy.deviceRevoked
    : allowed.length === 0 ? copy.deviceActionBlocked(platformWord) : null;
  const window = standing?.window ?? null;
  const open = window !== null && window.enabled && window.expiresAt !== null;

  return (
    <article className="flex flex-col gap-3 border-b border-[var(--hairline)] py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-row">{device.name}</span>
        {device.platform === null ? null : <span className="ops-tag">{platformWord}</span>}
        {gone ? <span className="ops-tag">{copy.deviceRevoked}</span> : null}
        <span className="ml-auto font-mono text-micro text-[var(--muted-foreground)]">
          {formatWhenAgo(device.lastSeenAt)}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
        <span className="flex items-baseline gap-1.5">
          {copy.deviceColumns.version}
          <Value value={device.appVersion} source={copy.sourceWord.telemetry} tier="body" mono />
        </span>
        <span className="flex items-baseline gap-1.5">
          {copy.deviceColumns.os}
          <Value value={device.osVersion} source={copy.sourceWord.telemetry} tier="body" />
        </span>
        <span className="flex items-baseline gap-1.5">
          {copy.deviceColumns.node}
          <Value value={device.selectedServer} source={copy.sourceWord.catalog} tier="body" />
        </span>
      </div>

      <p className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
        {standingWord(standing, loading)}
        {open && window !== null && window.expiresAt !== null
          ? ` · ${copy.deviceLogsUntil(formatWhen(window.expiresAt))}`
          : ''}
      </p>

      <WriteError message={ask.error} />

      <ActionRow>
        {DEVICE_ACTIONS.map((action) => (
          <Action
            key={action}
            reason={blocked ?? (allowed.includes(action) ? null : copy.deviceActionBlocked(platformWord))}
            pending={ask.pending}
            onClick={() => ask.ask({
              title: copy.deviceActionTitle(actionWord(action)),
              consequence: action === 'retry_protection'
                ? copy.deviceRetryBody(device.name)
                : copy.deviceActionBody(actionWord(action), device.name),
              confirm: copy.deviceQueued(actionWord(action)),
              run: () => customerApi.queueDeviceAction(device.id, action),
            })}
          >
            {actionWord(action)}
          </Action>
        ))}
        <Action
          reason={gone ? copy.deviceRevoked : null}
          pending={ask.pending}
          onClick={() => ask.ask(open ? {
            title: copy.deviceLogsOffTitle,
            consequence: copy.deviceLogsOffBody(device.name),
            confirm: copy.deviceLogsOff,
            run: () => customerApi.closeLogWindow(userId, device.id),
          } : {
            title: copy.deviceLogsOnTitle,
            consequence: copy.deviceLogsOnBody(device.name, formatWhen(logWindowEnd(nowSec()))),
            confirm: copy.deviceLogsOn,
            run: () => customerApi.openLogWindow(userId, device.id, logWindowEnd(nowSec())),
          })}
        >
          {open ? copy.deviceLogsOff : copy.deviceLogsOn}
        </Action>
        <Action
          className="ml-auto"
          reason={gone ? copy.deviceRevoked : null}
          onClick={() => setRevoking(true)}
        >
          {copy.deviceRevoke}
        </Action>
      </ActionRow>

      {ask.dialog}

      <ConfirmDialog
        open={revoking}
        title={copy.deviceRevokeTitle}
        consequence={copy.deviceRevokeBody(device.name)}
        confirm={copy.deviceRevoke}
        pending={ask.pending}
        failure={ask.error}
        onConfirm={() => {
          void ask.run(() => customerApi.revokeDevice(device.id)).then((done) => {
            if (done) setRevoking(false);
          });
        }}
        onCancel={() => {
          ask.clearError();
          setRevoking(false);
        }}
      />
    </article>
  );
}

/** What was last asked of this machine, or that nothing has been. */
function standingWord(standing: Standing | null, loading: boolean): string {
  if (standing === null) return loading ? copy.loading : copy.deviceNoAction;
  if (standing.last === null) return copy.deviceNoAction;
  return copy.deviceLastAction(
    actionWord(standing.last.action),
    statusWord(standing.last.status),
  );
}

/** The hub's action names, in the operator's words; an unknown one reads as itself. */
function actionWord(action: string): string {
  const known = copy.deviceActionWord as Record<string, string | undefined>;
  return known[action] ?? action;
}

function statusWord(status: string): string {
  const known = copy.deviceActionStatus as Record<string, string | undefined>;
  return known[status] ?? status;
}
