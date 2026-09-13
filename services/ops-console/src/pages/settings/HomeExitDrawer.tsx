import { useState } from 'react';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import { hubApi, type HomeExitInput } from '@/lib/settings-legacy';
import { FieldGrid, FormFooter, SelectField, TextField } from './form';
import { useWrite } from './use-write';

const words = copy.settings.homeinventory;

type Kind = 'catalog' | 'socks5';

type Draft = {
  displayName: string;
  proxyName: string;
  kind: Kind;
  egressIpv4: string;
  notes: string;
  socks5Host: string;
  socks5Port: string;
  socks5Username: string;
  socks5Password: string;
};

const BLANK: Draft = {
  displayName: '',
  proxyName: '',
  kind: 'socks5',
  egressIpv4: '',
  notes: '',
  socks5Host: '',
  socks5Port: '',
  socks5Username: '',
  socks5Password: '',
};

const KINDS: readonly Kind[] = ['socks5', 'catalog'];
const MIN_PORT = 1;
const MAX_PORT = 65_535;

function trimmed(value: string): string | undefined {
  const text = value.trim();
  return text === '' ? undefined : text;
}

/**
 * Registering one line by hand.
 *
 * The password box is the only control in the console whose value is never
 * read back from anywhere: no endpoint returns it, this component drops its
 * copy the moment the drawer closes, and there is no edit form for it — a line
 * whose credentials changed is registered again. That is why this is a drawer
 * of its own rather than a row you can click into: an editable field that
 * always renders blank teaches the operator that the stored password is blank.
 */
export function HomeExitDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [fault, setFault] = useState<string | null>(null);
  const write = useWrite(onSaved);

  const socks5 = draft.kind === 'socks5';

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFault(null);
  }

  function shut() {
    setDraft(BLANK);
    setFault(null);
    write.setError(null);
    onClose();
  }

  function save() {
    const port = Number(draft.socks5Port.trim());
    if (draft.displayName.trim() === '' || draft.proxyName.trim() === '') {
      setFault(copy.settings.required);
      return;
    }
    if (socks5) {
      const missing = draft.socks5Host.trim() === ''
        || draft.socks5Username.trim() === ''
        || draft.socks5Password === '';
      if (missing) {
        setFault(copy.settings.required);
        return;
      }
      if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
        setFault(words.hints.socks5Port);
        return;
      }
    }
    const input: HomeExitInput = {
      proxyName: draft.proxyName.trim(),
      displayName: draft.displayName.trim(),
      kind: draft.kind,
      egressIpv4: trimmed(draft.egressIpv4),
      notes: trimmed(draft.notes),
      ...(socks5 ? {
        socks5Host: draft.socks5Host.trim(),
        socks5Port: port,
        socks5Username: draft.socks5Username.trim(),
        socks5Password: draft.socks5Password,
      } : {}),
    };
    void write.run(() => hubApi.createHomeExit(input)).then((done) => {
      if (done) shut();
    });
  }

  return (
    <DetailDrawer open={open} title={words.registerTitle} onClose={shut}>
      <p className="text-body text-[var(--muted-foreground)]">{words.registerLead}</p>
      <FieldGrid>
        <TextField
          label={words.fields.displayName}
          value={draft.displayName}
          onChange={(value) => set('displayName', value)}
        />
        <TextField
          label={words.fields.proxyName}
          hint={words.hints.proxyName}
          value={draft.proxyName}
          onChange={(value) => set('proxyName', value)}
          mono
        />
        <SelectField
          label={words.fields.kind}
          value={draft.kind}
          options={KINDS}
          word={(option) => words.kind[option]}
          onChange={(value) => set('kind', value)}
        />
        {socks5 ? (
          <>
            <TextField
              label={words.fields.socks5Host}
              value={draft.socks5Host}
              onChange={(value) => set('socks5Host', value)}
              mono
            />
            <TextField
              label={words.fields.socks5Port}
              hint={words.hints.socks5Port}
              value={draft.socks5Port}
              onChange={(value) => set('socks5Port', value)}
              mono
            />
            <TextField
              label={words.fields.socks5Username}
              value={draft.socks5Username}
              onChange={(value) => set('socks5Username', value)}
              mono
            />
            <TextField
              label={words.fields.socks5Password}
              hint={words.hints.socks5Password}
              value={draft.socks5Password}
              onChange={(value) => set('socks5Password', value)}
              type="password"
            />
          </>
        ) : null}
        <TextField
          label={words.fields.egressIpv4}
          hint={words.hints.egressIpv4}
          value={draft.egressIpv4}
          onChange={(value) => set('egressIpv4', value)}
          mono
        />
        <TextField
          label={words.fields.notes}
          value={draft.notes}
          onChange={(value) => set('notes', value)}
        />
      </FieldGrid>
      <FormFooter
        pending={write.pending}
        error={fault ?? write.error}
        onSave={save}
        onCancel={shut}
      />
    </DetailDrawer>
  );
}
