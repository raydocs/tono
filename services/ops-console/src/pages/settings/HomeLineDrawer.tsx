import { useEffect, useState } from 'react';
import type { HomeLineDto } from '@contract';
import { BILLING_KINDS, METER_SOURCES } from '@contract';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import { settingsApi, type HomeLineInput } from '@/lib/api-settings';
import { formatBytesMeasured, formatDate } from '@/lib/display';
import { measured } from '@/components/ops/measured';
import { fromDateInput, toDateInput, usageDays, type UsageDay } from '@/lib/settings';
import { shown } from '@/lib/sources';
import { useResource } from '@/lib/use-resource';
import { statusWord } from './HomeLines';
import { FieldGrid, FormFooter, SelectField, TextField } from './form';
import { useWrite } from './use-write';

const words = copy.settings.homelines;

const BLANK: HomeLineInput = {
  proxyName: '',
  displayName: '',
  isp: null,
  region: null,
  providerAccountId: null,
  price: null,
  currency: null,
  billingKind: null,
  bundleBytes: null,
  cycleStart: null,
  cycleEnd: null,
  expiresAt: null,
  meterSource: null,
  notes: null,
};

const GIB = 1024 ** 3;

function orNull(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

function numberOrNull(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The allowance is typed in GB, because that is how the plan is sold. */
function gibToBytes(value: string): number | null {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.round(parsed * GIB);
}

function bytesToGib(value: number | null): string {
  return value === null ? '' : String(Math.round(value / GIB));
}

function toInput(line: HomeLineDto): HomeLineInput {
  return {
    proxyName: line.proxyName,
    displayName: line.displayName,
    isp: line.isp,
    region: line.region,
    providerAccountId: line.providerAccountId,
    price: line.price,
    currency: line.currency,
    billingKind: line.billingKind,
    bundleBytes: line.bundleBytes,
    cycleStart: line.cycleStart,
    cycleEnd: line.cycleEnd,
    expiresAt: line.expiresAt,
    meterSource: line.meterSource,
    notes: line.notes,
  };
}

/**
 * One line: what is known about it, what it has carried for a month, and the
 * boxes that change any of it.
 *
 * The facts come first and the form second because the reason to open this
 * drawer is almost always to check something rather than to change it — the
 * month's shape answers "is this line worth keeping" before the operator has
 * to read a single label.
 */
export function HomeLineDrawer({
  line,
  onClose,
  onSaved,
  onRemove,
}: {
  line: HomeLineDto | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
  onRemove: (line: HomeLineDto) => void;
}) {
  const existing = line === null || line === 'new' ? null : line;
  const [form, setForm] = useState<HomeLineInput>(BLANK);
  const write = useWrite(onSaved);
  const usage = useResource(
    existing?.id ?? null,
    (signal) => settingsApi.homeLineUsage(existing?.id ?? '', signal),
  );
  const set = <K extends keyof HomeLineInput>(key: K, value: HomeLineInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (line === null) return;
    setForm(line === 'new' ? BLANK : toInput(line));
  }, [line]);

  async function save() {
    if (form.displayName.trim() === '' || form.proxyName.trim() === '') {
      write.setError(copy.settings.required);
      return;
    }
    const ok = await write.run(() => {
      if (!existing) return settingsApi.createHomeLine(form);
      const { proxyName: _kept, ...rest } = form;
      return settingsApi.updateHomeLine(existing.id, rest);
    });
    if (ok) onClose();
  }

  return (
    <DetailDrawer
      open={line !== null}
      title={existing ? existing.displayName : words.newLine}
      onClose={onClose}
    >
      {existing ? (
        <>
          <div className="flex flex-col">
            <Fact
              label={words.columns.status}
              measured={measured(statusWord(existing.status), existing.updatedAt, copy.sourceWord.manual)}
            />
            <UsageFacts line={existing} />
            <Fact
              label={words.columns.expires}
              measured={measured(
                existing.expiresAt === null ? null : formatDate(existing.expiresAt),
                existing.expiresAt,
                copy.sourceWord.manual,
              )}
            />
          </div>
          <UsageStrip
            days={usage.status === 'ready' ? usageDays(usage.data.items) : []}
            ready={usage.status === 'ready'}
          />
        </>
      ) : null}

      <FieldGrid>
        <TextField
          label={words.fields.displayName}
          value={form.displayName}
          onChange={(value) => set('displayName', value)}
        />
        {existing ? null : (
          <TextField
            label={words.fields.proxyName}
            hint={words.hints.proxyName}
            value={form.proxyName}
            mono
            onChange={(value) => set('proxyName', value)}
          />
        )}
        <TextField
          label={words.fields.isp}
          value={form.isp ?? ''}
          onChange={(value) => set('isp', orNull(value))}
        />
        <TextField
          label={words.fields.region}
          value={form.region ?? ''}
          onChange={(value) => set('region', orNull(value))}
        />
        <SelectField
          label={words.fields.billingKind}
          value={form.billingKind ?? 'monthly'}
          options={BILLING_KINDS}
          word={(option) => words.billingKind[option]}
          onChange={(value) => set('billingKind', value)}
        />
        <TextField
          label={words.fields.bundleBytes}
          hint={words.hints.bundleBytes}
          value={bytesToGib(form.bundleBytes)}
          mono
          onChange={(value) => set('bundleBytes', gibToBytes(value))}
        />
        <TextField
          label={words.fields.price}
          value={form.price === null ? '' : String(form.price)}
          mono
          onChange={(value) => set('price', numberOrNull(value))}
        />
        <TextField
          label={words.fields.currency}
          value={form.currency ?? ''}
          mono
          onChange={(value) => set('currency', orNull(value))}
        />
        <TextField
          label={words.fields.cycleStart}
          hint={words.hints.cycleStart}
          type="date"
          value={toDateInput(form.cycleStart)}
          mono
          onChange={(value) => set('cycleStart', fromDateInput(value))}
        />
        <TextField
          label={words.fields.cycleEnd}
          type="date"
          value={toDateInput(form.cycleEnd)}
          mono
          onChange={(value) => set('cycleEnd', fromDateInput(value))}
        />
        <TextField
          label={words.fields.expiresAt}
          type="date"
          value={toDateInput(form.expiresAt)}
          mono
          onChange={(value) => set('expiresAt', fromDateInput(value))}
        />
        <SelectField
          label={words.fields.meterSource}
          hint={words.hints.meterSource}
          value={form.meterSource ?? 'manual'}
          options={METER_SOURCES}
          word={(option) => words.meterSource[option]}
          onChange={(value) => set('meterSource', value)}
        />
        <TextField
          label={words.fields.notes}
          value={form.notes ?? ''}
          onChange={(value) => set('notes', orNull(value))}
        />
      </FieldGrid>

      <FormFooter
        pending={write.pending}
        error={write.error}
        onSave={() => { void save(); }}
        onCancel={onClose}
        onRemove={existing ? () => onRemove(existing) : undefined}
      />
    </DetailDrawer>
  );
}

/** Up, down and how many people are on it — one read, so one stamp. */
function UsageFacts({ line }: { line: HomeLineDto }) {
  const usage = shown(line.usage);
  const bound = shown(line.boundUsers);
  return (
    <>
      <Fact
        label={words.facts.up}
        measured={measured(
          usage.value === null ? null : formatBytesMeasured(usage.value.bytesUp),
          line.usage.asOfSec,
          usage.source,
        )}
      />
      <Fact
        label={words.facts.down}
        measured={measured(
          usage.value === null ? null : formatBytesMeasured(usage.value.bytesDown),
          line.usage.asOfSec,
          usage.source,
        )}
      />
      <Fact
        label={words.facts.users}
        measured={measured(
          bound.value === null ? null : String(bound.value),
          line.boundUsers.asOfSec,
          bound.source,
        )}
      />
    </>
  );
}

/**
 * Thirty bars, one a day, scaled to the busiest of them.
 *
 * A day nobody metered draws nothing at all rather than a zero-height bar,
 * because the two are the same picture and only one of them is a reason to go
 * and look at the meter.
 */
function UsageStrip({ days, ready }: { days: UsageDay[]; ready: boolean }) {
  const peak = days.reduce((max, day) => Math.max(max, day.bytes ?? 0), 0);
  if (!ready || peak === 0) {
    return (
      <p className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]" role="status">
        {ready ? words.usageEmpty : copy.loading}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-10 items-end gap-[2px] border-b border-[var(--hairline)]">
        {days.map((day) => <UsageBar key={day.dayAt} day={day} peak={peak} />)}
      </div>
      <p className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
        {words.usageStrip}
      </p>
    </div>
  );
}

/** One day. The floor of six percent keeps a quiet day visible as a quiet day. */
function UsageBar({ day, peak }: { day: UsageDay; peak: number }) {
  const bytes = day.bytes;
  const missing = bytes === null;
  const share = missing ? 0 : Math.max(6, (bytes / peak) * 100);
  const height = missing ? '2px' : `${share}%`;
  return (
    <span
      title={`${formatDate(day.dayAt)} · ${missing ? copy.missing : formatBytesMeasured(bytes)}`}
      className="min-w-0 flex-1 rounded-[1px]"
      style={{
        height,
        background: missing ? 'var(--hairline)' : 'var(--accent)',
        opacity: missing ? 1 : 0.75,
      }}
    />
  );
}
