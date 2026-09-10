// Payload shaping for the alert outbox. Kept beside alerts.ts so that module
// stays under the 500-line budget.

import type { AlertTemplate, IncidentPhase, IncidentTransition, AlertSeverity } from './alerts';

const TELEGRAM_TEXT_LIMIT = 3_500;
const SEVERITY_ZH: Record<AlertSeverity, string> = { severe: '严重', warn: '警告', notice: '提示' };
const PHASE_ZH: Record<IncidentPhase, string> = { open: '触发', escalate: '升级', resolve: '恢复' };

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export function incidentConsoleUrl(consoleUrl: string, incidentId: string): string {
  return `${consoleUrl.replace(/\/+$/, '')}/incidents/${incidentId}`;
}

export function chineseAlertText(t: IncidentTransition, url: string): string {
  return [
    `【Tono】${SEVERITY_ZH[t.severity]} · ${PHASE_ZH[t.transition]}`,
    t.title,
    t.detail,
    `对象: ${t.subjectType}/${t.subjectId}`,
    `影响: ${t.impactCount}`,
    url,
  ].join('\n').slice(0, TELEGRAM_TEXT_LIMIT);
}

export async function shapePayload(
  template: AlertTemplate,
  t: IncidentTransition,
  opts: { consoleUrl: string; target: string; secret?: string; sentAt?: number },
): Promise<{ url: string; headers: Record<string, string>; body: string }> {
  const sentAt = opts.sentAt ?? Math.floor(Date.now() / 1000);
  const url = incidentConsoleUrl(opts.consoleUrl, t.incidentId);
  const text = chineseAlertText(t, url);
  const jsonHeaders = { 'content-type': 'application/json' };

  if (template === 'telegram') {
    return {
      url: `https://api.telegram.org/bot${opts.secret ?? ''}/sendMessage`,
      headers: jsonHeaders,
      // parse_mode is omitted on purpose: Markdown in a title/detail
      // (underscores, backticks) is an escaping bug waiting to happen.
      body: JSON.stringify({ chat_id: opts.target, text }),
    };
  }
  if (template === 'feishu') {
    return {
      url: opts.target,
      headers: jsonHeaders,
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    };
  }
  if (template === 'slack') {
    return {
      url: opts.target,
      headers: jsonHeaders,
      body: JSON.stringify({ text }),
    };
  }

  const body = JSON.stringify({
    version: 1,
    event: `incident.${t.transition}`,
    incident: {
      id: t.incidentId,
      kind: t.kind,
      severity: t.severity,
      subject: { type: t.subjectType, id: t.subjectId },
      title: t.title,
      detail: t.detail,
      openedAt: t.openedAt,
      impactCount: t.impactCount,
      url,
    },
    sentAt,
  });
  const headers: Record<string, string> = { ...jsonHeaders };
  if (opts.secret) {
    headers['X-Tono-Signature'] = `sha256=${await hmacSha256Hex(body, opts.secret)}`;
  }
  return { url: opts.target, headers, body };
}
