import { useState } from 'react';
import { Action } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { FoldedSection } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { formatWhen } from '@/lib/display';
import { hubApi, type CatalogHistoryRow } from '@/lib/settings-legacy';
import { checkCatalog } from '@/lib/settings-publish';
import { useResource } from '@/lib/use-resource';
import {
  CodeBox,
  DiffView,
  DocumentGate,
  DocumentMeta,
  FailurePanel,
  NoticePanel,
} from './Editor';
import { useDocument } from './use-document';

const words = copy.settings.catalog;

/**
 * The node catalogue: the one document on this console that every customer's
 * client reads.
 *
 * It used to be a signpost pointing at the old console, because two editors for
 * one file is a fleet where half the nodes came from each. This is the only
 * editor now, so it carries the whole ceremony the old one had: the base
 * version is frozen when editing starts, the draft is checked against the same
 * gates the hub applies before a confirmation is even offered, the confirmation
 * says what happens to every client rather than asking whether you are sure,
 * and a rejected publish reloads the live copy and reports the drift instead of
 * quietly trying again.
 */
export function Catalog() {
  const doc = useDocument((signal) => hubApi.exitCatalog(signal).then((row) => ({
    revision: row.revision,
    text: row.yaml,
    updatedAt: row.updatedAt,
    extra: row.sha256,
  })));
  const [asking, setAsking] = useState<'publish' | 'reload' | null>(null);

  const online = doc.online;
  if (online === null) {
    return <DocumentGate status={doc.status === 'error' ? 'error' : 'loading'} message={doc.message} />;
  }

  const draft = doc.draft;
  const dirty = draft !== null && doc.base !== null && draft !== doc.base.text;
  const check = draft === null ? null : checkCatalog(draft);
  const blocked = check === null
    ? words.clean
    : check.ok === false
      ? words.fault[check.fault]
      : dirty ? null : words.clean;

  async function reloadOnline() {
    await doc.reload((fresh) => ({ text: words.reloadDone(fresh.revision), detail: null, bad: false }));
    setAsking(null);
  }

  async function publish() {
    if (draft === null) return;
    await doc.publish(
      async (expected) => (await hubApi.publishCatalog(draft, expected)).revision,
      {
        told: (was, now) => ({ text: words.published(was, now), detail: null, bad: false }),
        conflict: (was, fresh, drift) => ({
          text: words.conflictTitle,
          detail: [
            words.conflictBody(was, fresh.revision),
            words.conflictDiff(drift.added, drift.removed),
          ].join(' '),
          bad: true,
        }),
      },
    );
    setAsking(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <DocumentMeta
          version={words.online(online.revision)}
          updatedAt={online.updatedAt}
          never={words.never}
          updatedWord={words.updated}
        >
          {draft === null ? (
            <Action primary onClick={doc.start}>{words.edit}</Action>
          ) : (
            <>
              <Action
                pending={doc.pending}
                onClick={() => { if (dirty) setAsking('reload'); else void reloadOnline(); }}
              >
                {words.reload}
              </Action>
              <Action primary reason={blocked} pending={doc.pending} onClick={() => setAsking('publish')}>
                {words.publish}
              </Action>
            </>
          )}
        </DocumentMeta>

        {doc.notice ? <NoticePanel notice={doc.notice} /> : null}
        {doc.failure ? <FailurePanel failure={doc.failure} /> : null}

        <CodeBox
          label={words.editorLabel}
          value={draft ?? online.text}
          onChange={draft === null ? undefined : doc.change}
        />

        {check === null ? null : (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-body text-[var(--muted-foreground)]">
            {check.ok ? (
              <span className="font-mono text-fine">{words.nodeCount(check.nodes)}</span>
            ) : (
              <span>{words.fault[check.fault]}</span>
            )}
          </p>
        )}

        {doc.diff === null ? null : dirty ? (
          <DiffView
            diff={doc.diff}
            summary={words.changed(doc.diff.added, doc.diff.removed)}
            truncated={doc.diff.truncated ? words.truncated : null}
          />
        ) : (
          <p className="text-body text-[var(--muted-foreground)]">{words.clean}</p>
        )}
      </div>

      <FoldedSection title={words.history}>
        <History />
      </FoldedSection>

      <ConfirmDialog
        open={asking === 'publish'}
        title={words.publishTitle}
        consequence={words.publishBody}
        confirm={words.publish}
        pending={doc.pending}
        failure={doc.failure}
        onConfirm={() => { void publish(); }}
        onCancel={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === 'reload'}
        title={words.reloadTitle}
        consequence={words.reloadBody}
        confirm={words.reload}
        pending={doc.pending}
        onConfirm={() => { void reloadOnline(); }}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}

/**
 * What has been published, as far back as the hub keeps a record.
 *
 * Only summaries: the fingerprint, how many machines that version carried and
 * when it went out. The text of an older version exists nowhere — not here and
 * not on the old console — so there is deliberately nothing to press that would
 * imply a rollback is one click away.
 */
function History() {
  const history = useResource('catalog-revisions', (signal) => hubApi.catalogHistory(signal));
  const rows = history.status === 'ready' ? history.data : [];
  const state: TableState = history.status === 'loading'
    ? 'loading'
    : history.status === 'error'
      ? 'error'
      : rows.length === 0 ? 'empty' : 'ready';

  return (
    <DataTable
      rows={rows}
      columns={HISTORY_COLUMNS}
      getRowId={(row) => String(row.revision)}
      state={state}
      emptyMessage={words.historyEmpty}
      errorMessage={history.status === 'error' ? history.message : undefined}
    />
  );
}

const HISTORY_COLUMNS: DataColumn<CatalogHistoryRow>[] = [
  {
    id: 'version',
    header: words.historyColumns.version,
    width: '132px',
    sortValue: (row) => row.revision,
    cell: (row) => (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="font-mono text-row">{words.online(row.revision)}</span>
        {row.current ? <span className="ops-tag">{words.current}</span> : null}
      </span>
    ),
  },
  {
    id: 'nodes',
    header: words.historyColumns.nodes,
    width: '88px',
    align: 'right',
    mono: true,
    sortValue: (row) => row.serverCount,
    cell: (row) => words.nodeCount(row.serverCount),
  },
  {
    id: 'at',
    header: words.historyColumns.at,
    width: '168px',
    align: 'right',
    mono: true,
    sortValue: (row) => row.publishedAt,
    cell: (row) => formatWhen(row.publishedAt),
  },
  {
    id: 'sha',
    header: words.historyColumns.sha,
    sortValue: (row) => row.sha256,
    cell: (row) => (
      <span className="truncate font-mono text-fine" title={row.sha256}>{row.sha256}</span>
    ),
  },
];
