import { useEffect, useState } from 'react';
import type { AlertRuleDto } from '@contract';
import { ALERT_CHANNELS, ALERT_FIRE_ON, ALERT_TEMPLATES, SEVERITIES } from '@contract';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import { settingsApi, type AlertRuleInput } from '@/lib/api-settings';
import { BoolField, FieldGrid, FormFooter, SelectField, TextField } from './form';
import { useWrite } from './use-write';

const words = copy.settings.alerts;

const BLANK: AlertRuleInput = {
  name: '',
  enabled: true,
  matchKind: null,
  matchSubjectType: null,
  matchSubjectId: null,
  minSeverity: 'warn',
  minImpact: 0,
  fireOn: 'open',
  delaySeconds: 90,
  cooldownSeconds: 3_600,
  channel: 'webhook',
  target: '',
  template: 'generic',
  secretRef: null,
};

function toInput(rule: AlertRuleDto): AlertRuleInput {
  const { id: _id, lastFiredAt: _fired, createdAt: _made, updatedAt: _changed, ...rest } = rule;
  return rest;
}

/** Empty boxes are absences, not empty strings: the Worker stores `null`. */
function orNull(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

/** A typed-in count. A box someone cleared reads as zero, never as drift. */
function whole(value: string, fallback: number): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

/**
 * The rule editor. One drawer for both new and existing rules, because the
 * fields are the same and a second layout for "create" is a second place for
 * the defaults to drift.
 *
 * `secretRef` is the field to be careful about: it names a Worker secret, and
 * the helper says so. A credential typed in here would be stored in the
 * database in clear, which is exactly the failure the indirection prevents.
 */
export function AlertRuleDrawer({
  rule,
  onClose,
  onSaved,
  onRemove,
}: {
  rule: AlertRuleDto | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
  onRemove: (rule: AlertRuleDto) => void;
}) {
  const existing = rule === null || rule === 'new' ? null : rule;
  const [form, setForm] = useState<AlertRuleInput>(BLANK);
  const write = useWrite(onSaved);
  const set = <K extends keyof AlertRuleInput>(key: K, value: AlertRuleInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (rule === null) return;
    setForm(rule === 'new' ? BLANK : toInput(rule));
  }, [rule]);

  async function save() {
    if (form.name.trim() === '') {
      write.setError(copy.settings.required);
      return;
    }
    const ok = await write.run(() => (
      existing
        ? settingsApi.updateAlertRule(existing.id, form)
        : settingsApi.createAlertRule(form)
    ));
    if (ok) onClose();
  }

  return (
    <DetailDrawer
      open={rule !== null}
      title={existing ? words.editRule : words.newRule}
      onClose={onClose}
    >
      <FieldGrid>
        <TextField
          label={words.fields.name}
          value={form.name}
          onChange={(value) => set('name', value)}
        />
        <BoolField
          label={words.fields.enabled}
          value={form.enabled}
          trueWord={words.on}
          falseWord={words.off}
          onChange={(value) => set('enabled', value)}
        />
        <SelectField
          label={words.fields.minSeverity}
          value={form.minSeverity}
          options={SEVERITIES}
          word={(option) => copy.severity[option]}
          onChange={(value) => set('minSeverity', value)}
        />
        <TextField
          label={words.fields.minImpact}
          hint={words.hints.minImpact}
          value={String(form.minImpact)}
          mono
          onChange={(value) => set('minImpact', whole(value, 0))}
        />
        <SelectField
          label={words.fields.fireOn}
          value={form.fireOn}
          options={ALERT_FIRE_ON}
          word={(option) => words.fireOn[option]}
          onChange={(value) => set('fireOn', value)}
        />
        <TextField
          label={words.fields.delaySeconds}
          hint={words.hints.delaySeconds}
          value={String(form.delaySeconds)}
          mono
          onChange={(value) => set('delaySeconds', whole(value, 0))}
        />
        <TextField
          label={words.fields.cooldownSeconds}
          hint={words.hints.cooldownSeconds}
          value={String(form.cooldownSeconds)}
          mono
          onChange={(value) => set('cooldownSeconds', whole(value, 0))}
        />
        <SelectField
          label={words.fields.channel}
          value={form.channel}
          options={ALERT_CHANNELS}
          word={(option) => words.channel[option]}
          onChange={(value) => set('channel', value)}
        />
        <TextField
          label={words.fields.target}
          hint={words.hints.target}
          value={form.target}
          mono
          onChange={(value) => set('target', value)}
        />
        <SelectField
          label={words.fields.template}
          value={form.template}
          options={ALERT_TEMPLATES}
          word={(option) => words.template[option]}
          onChange={(value) => set('template', value)}
        />
        <TextField
          label={words.fields.secretRef}
          hint={words.hints.secretRef}
          value={form.secretRef ?? ''}
          mono
          onChange={(value) => set('secretRef', orNull(value))}
        />
        <TextField
          label={words.fields.matchKind}
          hint={words.hints.matchKind}
          value={form.matchKind ?? ''}
          mono
          onChange={(value) => set('matchKind', orNull(value))}
        />
        <TextField
          label={words.fields.matchSubjectId}
          value={form.matchSubjectId ?? ''}
          mono
          onChange={(value) => set('matchSubjectId', orNull(value))}
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
