import type { ConnectionEventKind, Severity } from '@contract';
import type { Tone } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';

type CodeKey = keyof typeof copy.codeWord;
type StageKey = keyof typeof copy.stageWord;

const CODES = Object.keys(copy.codeWord) as CodeKey[];
const STAGES = Object.keys(copy.stageWord) as StageKey[];

/**
 * The Chinese sentence behind a dial error code.
 *
 * An operator reading `TLS_HANDSHAKE_TIMEOUT` in a timeline learns nothing an
 * hour later, and the code is what the client actually reported, so the row
 * shows both: the code in mono, the sentence beside it. A code nobody has
 * written a line for falls back to "客户端没说原因" rather than rendering the
 * raw token twice.
 */
export function explainCode(code: string | null): string | null {
  if (!code) return null;
  const key = code.toUpperCase() as CodeKey;
  return CODES.includes(key) ? copy.codeWord[key] : copy.codeWord.UNKNOWN;
}

/** 拨号 / 握手 / 加密 / 取节点 / 探测 — where in the attempt it fell over. */
export function stageWord(stage: string | null): string | null {
  if (!stage) return null;
  const key = stage.toLowerCase() as StageKey;
  return STAGES.includes(key) ? copy.stageWord[key] : stage;
}

export function eventWord(kind: ConnectionEventKind): string {
  return copy.eventWord[kind];
}

const FAILED: ConnectionEventKind[] = ['connectFail', 'healthProbeFail', 'releaseFail', 'syncFail'];
const SWITCHED: ConnectionEventKind[] = ['nodeSwitch', 'connectCatalogFailover'];
const SUCCEEDED: ConnectionEventKind[] = ['connectOk'];

export function isFailure(kind: ConnectionEventKind): boolean {
  return FAILED.includes(kind);
}

export function isSwitch(kind: ConnectionEventKind): boolean {
  return SWITCHED.includes(kind);
}

export function isSuccess(kind: ConnectionEventKind): boolean {
  return SUCCEEDED.includes(kind);
}

/** One word, one tone. Everything that is neither a win nor a loss stays grey. */
export function eventTone(kind: ConnectionEventKind): Tone {
  if (isFailure(kind)) return 'sev';
  if (isSuccess(kind)) return 'ok';
  if (isSwitch(kind)) return 'info';
  return 'unk';
}

export function severityTone(severity: Severity): Tone {
  if (severity === 'severe') return 'sev';
  if (severity === 'warn') return 'warn';
  return 'info';
}
