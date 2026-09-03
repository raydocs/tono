export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}

export function maskIp(value: string): string {
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/);
  if (ipv4 && ipv4.slice(1, 5).every((part) => Number(part) <= 255)) {
    return `${ipv4[1]}.${ipv4[2]}.***.***`;
  }
  // One colon is normally hostname:port, not IPv6. Mask that whole value so a
  // SOCKS hostname cannot slip through a helper intended for IP addresses.
  const address = value.match(/^\[([^\]]+)\](?::\d+)?$/)?.[1] ?? value;
  if ((address.match(/:/g) ?? []).length >= 2 && /^[0-9a-f:.%]+$/i.test(address)) {
    const firstHextet = address.split(':').find((part) => /^[0-9a-f]{1,4}$/i.test(part));
    return firstHextet ? `${firstHextet}:***` : '***';
  }
  return '***';
}

export function maskMoney(value: string): string {
  return value.replace(/\d/g, '•');
}
