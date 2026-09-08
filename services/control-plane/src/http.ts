export function parseBytesRange(
  header: string | null,
  size: number,
): { offset: number; length: number } | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  if (startText === '' && endText === '') return null;
  let start: number;
  let end: number;
  if (startText === '') {
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Number(endText);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  if (end >= size) end = size - 1;
  return { offset: start, length: end - start + 1 };
}
