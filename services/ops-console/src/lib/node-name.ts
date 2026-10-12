const SEPARATOR = ' · ';

/**
 * Node names are `City · Site`. Six of them share a city, so a phone that
 * truncates the cell shows six identical "Los Ang…". The part after the last
 * separator is the part that tells them apart. A separator inside full-width
 * parentheses belongs to the remark it sits in, not to the split.
 */
export function splitNodeName(name: string): { prefix: string | null; main: string } {
  const text = name.trim();
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\uFF08') depth += 1;
    else if (char === '\uFF09') depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(SEPARATOR, i)) cut = i;
  }
  if (cut < 0) return { prefix: null, main: text };
  const prefix = text.slice(0, cut).trim();
  const main = text.slice(cut + SEPARATOR.length).trim();
  return prefix && main ? { prefix, main } : { prefix: null, main: text };
}

/**
 * The site line without its trailing full-width parenthetical (a remark such
 * as the one after "Site-01"): it shows as "Site-01", and the whole name stays
 * on the cell's hover. A name that is
 * nothing but a remark is left as it is, so the line is never empty.
 */
export function withoutRemark(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.endsWith('\uFF09')) return trimmed;
  let depth = 0;
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const char = trimmed[i];
    if (char === '\uFF09') depth += 1;
    else if (char === '\uFF08') {
      depth -= 1;
      if (depth === 0) {
        const head = trimmed.slice(0, i).trim();
        return head === '' ? trimmed : head;
      }
    }
  }
  return trimmed;
}
