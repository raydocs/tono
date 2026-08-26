export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}

export function maskIp(value: string): string {
  if (value.includes(':')) {
    const parts = value.split(':').filter(Boolean);
    if (parts.length === 0) return '***';
    return `${parts[0]}:***`;
  }
  const parts = value.split('.');
  if (parts.length !== 4) return '***';
  return `${parts[0]}.${parts[1]}.***.***`;
}

export function maskMoney(value: string): string {
  return value.replace(/\d/g, '•');
}
