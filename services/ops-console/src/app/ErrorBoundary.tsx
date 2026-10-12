import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Action } from '@/components/ops/Action';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';

const RELOADED_KEY = 'ops-chunk-reloaded';
const CHUNK_FAILURE = /Failed to fetch dynamically imported module|Importing a module script failed/;

/** A lazy page chunk that would not download, usually because a deploy replaced it. */
export function isChunkLoadFailure(error: unknown): boolean {
  return error instanceof Error && CHUNK_FAILURE.test(error.message);
}

/**
 * Reload once for a failed chunk, never twice in one tab session: the flag
 * outlives the reload, so a chunk that stays missing ends at the block below
 * instead of looping.
 */
function reloadOnce(): boolean {
  try {
    if (window.sessionStorage.getItem(RELOADED_KEY)) return false;
    window.sessionStorage.setItem(RELOADED_KEY, '1');
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * A render that throws, or a page chunk that fails to load, shows a block
 * with a way out instead of a blank page. The shell around it keeps working.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isChunkLoadFailure(error)) reloadOnce();
    else console.error(error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page-wrap">
        <Section title={copy.pageCrashed}>
          <p className="text-body">{copy.pageCrashedBody}</p>
          <div><Action primary onClick={() => window.location.reload()}>{copy.reloadPage}</Action></div>
        </Section>
      </div>
    );
  }
}
