/**
 * Line-level extraction of every proxy `name` under the `proxies:` list of a
 * plaintext Clash catalog. Mirrors the worker's catalogProxyName parsing;
 * quoted names are unescaped.
 */
export function catalogProxyNames(yaml: string): string[] {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const names: string[] = [];
  let inProxies = false;
  let blockIndent: number | null = null;
  let pendingBlock = false;
  for (const line of lines) {
    if (!inProxies) {
      if (/^proxies\s*:/.test(line)) inProxies = true;
      continue;
    }
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent === 0 && !line.trimStart().startsWith('-')) break;
    if (/^\s*-\s/.test(line)) {
      if (blockIndent === null) blockIndent = indent;
      if (indent !== blockIndent) continue;
      pendingBlock = true;
    } else if (!pendingBlock) {
      continue;
    }
    const match = line.match(
      /^\s*(?:-\s+)?name:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s#"'][^#]*?))\s*(?:#.*)?$/,
    );
    if (match) {
      const raw = match[1] ?? match[2] ?? match[3] ?? '';
      names.push(raw.replace(/\\(["'\\])/g, '$1'));
      pendingBlock = false;
    }
  }
  return names;
}
