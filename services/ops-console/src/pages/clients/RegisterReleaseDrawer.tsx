import { useEffect, useMemo, useState } from 'react';
import type { Platform, ReleaseChannel, ReleaseObjectDto } from '@contract';
import { PLATFORMS, RELEASE_CHANNELS } from '@contract';
import { Action } from '@/components/ops/Action';
import { LifecycleTag } from '@/components/ops/Chip';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { copy } from '@/copy/copy';
import { ApiRefusal, opsApi, type ReleaseCreateBody } from '@/lib/api';
import { formatBytesMeasured, formatWhen } from '@/lib/display';
import { useResource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';
import { Field, FieldGrid, FormFooter, SelectField, TextField } from '../settings/form';

const words = copy.releaseRegister;

const SHA256 = /^[0-9a-f]{64}$/;

/** What a registered release is called when the worker refuses it, in words an operator can act on. */
function refusalLine(error: unknown): string {
  if (error instanceof ApiRefusal) {
    if (error.code === 'RELEASE_CONFLICT') return words.conflict;
    if (error.code === 'RELEASE_UNVERIFIED') return words.unverified;
  }
  return error instanceof Error ? error.message : copy.actionFailed;
}

/** Unregistered first; the Worker's newest-first order holds inside each group. */
function unregisteredFirst(items: readonly ReleaseObjectDto[]): ReleaseObjectDto[] {
  return [...items.filter((row) => !row.registered), ...items.filter((row) => row.registered)];
}

const READONLY = 'min-h-8 w-full min-w-0 break-all rounded-[8px] border border-[var(--hairline)] bg-[var(--background)] px-2.5 py-1.5 font-mono text-body';
const AREA = 'min-h-[72px] w-full min-w-0 rounded-[8px] border border-[var(--hairline)] bg-[var(--background)] px-2.5 py-1.5 font-mono text-body outline-none focus:border-[var(--accent)]';

/**
 * Register release: put a file that is already in the release bucket on the books.
 *
 * The publish tooling writes the bucket and GitHub and never the database, so
 * a build is invisible to this page until someone registers it. The list is
 * the bucket itself, so what is registered is a file that exists; the form is
 * pre-filled from the file name and from the size and digest the bucket holds,
 * and those two are shown rather than typed, because a digest retyped by hand
 * is the typo the Worker's check would then have to refuse. Registering makes a
 * draft row (shown as pending); publishing stays the table's own, confirmed, action.
 */
export function RegisterReleaseDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const objects = useResource(
    open ? 'releases/objects' : null,
    (signal) => opsApi.releaseObjects(signal),
  );
  const [picked, setPicked] = useState<ReleaseObjectDto | null>(null);

  useEffect(() => {
    if (!open) setPicked(null);
  }, [open]);

  const items = useMemo(
    () => (objects.status === 'ready' ? unregisteredFirst(objects.data.items) : []),
    [objects],
  );

  return (
    <DetailDrawer open={open} title={words.title} onClose={onClose}>
      {picked !== null ? (
        <RegisterForm
          key={picked.key}
          object={picked}
          onBack={() => setPicked(null)}
          onCancel={onClose}
          onSaved={() => { onSaved(); onClose(); }}
        />
      ) : objects.status !== 'ready' ? (
        <Empty
          message={objects.status === 'loading' ? copy.loading : words.loadFailed}
        />
      ) : items.length === 0 ? (
        <Empty message={words.none} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-body text-[var(--muted-foreground)]">{words.pickLead}</p>
          <ul className="flex flex-col">
            {items.map((row) => (
              <li key={row.key} className="border-b border-[var(--hairline)] last:border-b-0">
                <button
                  type="button"
                  disabled={row.registered}
                  className={cn(
                    'flex w-full min-w-0 flex-col gap-1 py-2.5 text-left',
                    row.registered && 'cursor-not-allowed text-[var(--muted-foreground)]',
                  )}
                  onClick={() => setPicked(row)}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 break-all font-mono text-body">{row.key}</span>
                    {row.registered ? <LifecycleTag>{words.registered}</LifecycleTag> : null}
                  </span>
                  <span className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
                    {formatBytesMeasured(row.sizeBytes)} · {words.uploaded(formatWhen(row.uploadedAt))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DetailDrawer>
  );
}

function RegisterForm({
  object,
  onBack,
  onCancel,
  onSaved,
}: {
  object: ReleaseObjectDto;
  onBack: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>(object.guess?.platform ?? 'macos');
  const [channel, setChannel] = useState<ReleaseChannel>(object.guess?.channel ?? 'stable');
  const [version, setVersion] = useState(object.guess?.version ?? '');
  const [build, setBuild] = useState(object.guess?.build ?? '');
  const [sha256, setSha256] = useState(object.sha256 ?? '');
  const [signature, setSignature] = useState('');
  const [minOs, setMinOs] = useState('');
  const [notes, setNotes] = useState('');
  const [fault, setFault] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const signatureHint = platform === 'macos'
    ? words.signatureHint.macos
    : platform === 'windows' ? words.signatureHint.windows : words.signatureHint.other;

  function save() {
    const digest = sha256.trim().toLowerCase();
    if (version.trim() === '') {
      setFault(words.versionRequired);
      return;
    }
    if (!SHA256.test(digest)) {
      setFault(words.shaInvalid);
      return;
    }
    const body: ReleaseCreateBody = {
      platform,
      channel,
      version: version.trim(),
      r2Key: object.key,
      sizeBytes: object.sizeBytes,
      sha256: digest,
      ...(build.trim() === '' ? {} : { build: build.trim() }),
      ...(signature.trim() === '' ? {} : { signature: signature.trim() }),
      ...(minOs.trim() === '' ? {} : { minOsVersion: minOs.trim() }),
      ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
    };
    setFault(null);
    setPending(true);
    void opsApi.createRelease(body).then(
      () => { setPending(false); onSaved(); },
      (error: unknown) => { setPending(false); setFault(refusalLine(error)); },
    );
  }

  return (
    <>
      <div>
        <Action onClick={onBack}>{words.back}</Action>
      </div>
      <FieldGrid>
        <Field label={words.fieldKey}>
          <div className={READONLY}>{object.key}</div>
        </Field>
        <Field label={words.fieldSize}>
          <div className={READONLY}>{formatBytesMeasured(object.sizeBytes)}</div>
        </Field>
        {object.sha256 !== null ? (
          <Field label={words.fieldSha}>
            <div className={READONLY}>{object.sha256}</div>
          </Field>
        ) : (
          <TextField
            label={words.fieldSha}
            hint={words.shaMissing}
            value={sha256}
            onChange={setSha256}
            mono
          />
        )}
        <SelectField
          label={words.fieldPlatform}
          value={platform}
          options={PLATFORMS}
          word={(option) => copy.platform[option]}
          onChange={setPlatform}
        />
        <SelectField
          label={words.fieldChannel}
          value={channel}
          options={RELEASE_CHANNELS}
          word={(option) => copy.channel[option]}
          onChange={setChannel}
        />
        <TextField label={words.fieldVersion} value={version} onChange={setVersion} mono />
        <TextField label={words.fieldBuild} value={build} onChange={setBuild} mono />
        <Field label={words.fieldSignature} hint={signatureHint}>
          <textarea
            className={AREA}
            rows={3}
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
          />
        </Field>
        <TextField label={words.fieldMinOs} value={minOs} onChange={setMinOs} mono />
        <TextField label={words.fieldNotes} value={notes} onChange={setNotes} />
      </FieldGrid>
      <FormFooter pending={pending} error={fault} onSave={save} onCancel={onCancel} />
    </>
  );
}
