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
