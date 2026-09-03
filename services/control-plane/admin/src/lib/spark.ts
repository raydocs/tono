/** SVG path for a sparkline. Null values break the line instead of bridging the gap. */
export function sparkPath(values: Array<number | null>, width: number, height: number): string | null {
  const nums = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = width / Math.max(1, values.length - 1);
  const parts: string[] = [];
  let drawing = false;
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) {
      drawing = false;
      return;
    }
    const x = index * step;
    const y = height - ((value - min) / span) * height;
    parts.push(`${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
    drawing = true;
  });
  return parts.length < 2 ? null : parts.join(' ');
}
