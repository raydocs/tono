export type DiffLine = { kind: 'eq' | 'add' | 'del'; text: string };
export type DiffHunk = { aStart: number; bStart: number; lines: DiffLine[] };

export type LineDiff = {
  added: number;
  removed: number;
  hunks: DiffHunk[];
  truncated: boolean;
};

const MAX_LCS_CELLS = 1_500_000;
const MAX_RENDER_HUNKS = 40;
const CONTEXT = 2;

function lcsBacktrack(a: string[], b: string[]): Array<'eq' | 'add' | 'del'> {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_LCS_CELLS) {
    return greedyOps(a, b);
  }
  const dp = new Int32Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[idx(i, j)] = a[i] === b[j]
        ? dp[idx(i + 1, j + 1)] + 1
        : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
    }
  }
  const ops: Array<'eq' | 'add' | 'del'> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push('eq');
      i += 1;
      j += 1;
    } else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) {
      ops.push('del');
      i += 1;
    } else {
      ops.push('add');
      j += 1;
    }
  }
  while (i < n) { ops.push('del'); i += 1; }
  while (j < m) { ops.push('add'); j += 1; }
  return ops;
}

function greedyOps(a: string[], b: string[]): Array<'eq' | 'add' | 'del'> {
  const ops: Array<'eq' | 'add' | 'del'> = [];
  const bIndex = new Map<string, number[]>();
  b.forEach((line, index) => {
    const list = bIndex.get(line) ?? [];
    list.push(index);
    bIndex.set(line, list);
  });
  const cursor = new Map<string, number>();
  let ai = 0;
  let bj = 0;
  while (ai < a.length || bj < b.length) {
    if (ai < a.length && bj < b.length && a[ai] === b[bj]) {
      ops.push('eq');
      cursor.set(a[ai], (cursor.get(a[ai]) ?? 0) + 1);
      ai += 1;
      bj += 1;
      continue;
    }
    const list = ai < a.length ? bIndex.get(a[ai]) : undefined;
    if (list) {
      let at = cursor.get(a[ai]) ?? 0;
      while (at < list.length && list[at] < bj) at += 1;
      cursor.set(a[ai], at);
      if (at < list.length) {
        const next = list[at];
        while (bj < next) {
          ops.push('add');
          bj += 1;
        }
        ops.push('eq');
        cursor.set(a[ai], at + 1);
        ai += 1;
        bj += 1;
        continue;
      }
    }
    if (ai < a.length) {
      ops.push('del');
      ai += 1;
    } else {
      ops.push('add');
      bj += 1;
    }
  }
  return ops;
}

export function lineDiff(before: string, after: string): LineDiff {
  const a = before.split('\n');
  const b = after.split('\n');
  const ops = lcsBacktrack(a, b);
  let added = 0;
  let removed = 0;
  const annotated: Array<DiffLine & { aLine: number; bLine: number }> = [];
  let ai = 0;
  let bj = 0;
  for (const op of ops) {
    if (op === 'eq') {
      annotated.push({ kind: 'eq', text: a[ai], aLine: ai + 1, bLine: bj + 1 });
      ai += 1;
      bj += 1;
    } else if (op === 'del') {
      annotated.push({ kind: 'del', text: a[ai], aLine: ai + 1, bLine: bj + 1 });
      removed += 1;
      ai += 1;
    } else {
      annotated.push({ kind: 'add', text: b[bj], aLine: ai + 1, bLine: bj + 1 });
      added += 1;
      bj += 1;
    }
  }
  const changeIdx = annotated
    .map((line, index) => (line.kind === 'eq' ? -1 : index))
    .filter((index) => index >= 0);
  const hunks: DiffHunk[] = [];
  let cursor = 0;
  while (cursor < changeIdx.length) {
    const start = Math.max(0, changeIdx[cursor] - CONTEXT);
    let end = Math.min(annotated.length, changeIdx[cursor] + CONTEXT + 1);
    cursor += 1;
    while (cursor < changeIdx.length && changeIdx[cursor] <= end + CONTEXT) {
      end = Math.min(annotated.length, changeIdx[cursor] + CONTEXT + 1);
      cursor += 1;
    }
    const slice = annotated.slice(start, end);
    hunks.push({
      aStart: slice[0]?.aLine ?? 1,
      bStart: slice[0]?.bLine ?? 1,
      lines: slice.map(({ kind, text }) => ({ kind, text })),
    });
  }
  return {
    added,
    removed,
    hunks: hunks.slice(0, MAX_RENDER_HUNKS),
    truncated: hunks.length > MAX_RENDER_HUNKS,
  };
}
