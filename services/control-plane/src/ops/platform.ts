// Single os_version → platform mapping for flatten, releases, and customer
// projections. HarmonyOS / Hongmeng are recognised so they do not fall through
// to linux/android; they are not a catalog platform yet.

export const PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

/**
 * A client that names its platform wins over a guess from `os_version`: the
 * guess exists for windows written before the field did, and for clients that
 * have not shipped it yet.
 */
export function windowPlatform(
  payload: Record<string, unknown> | null | undefined,
  osVersion: string | null | undefined,
): Platform | null {
  const declared = payload?.platform;
  return isPlatform(declared) ? declared : sniffPlatform(osVersion);
}

export function sniffPlatform(osVersion: string | null | undefined): Platform | null {
  if (typeof osVersion !== 'string') return null;
  const value = osVersion.trim().toLowerCase();
  if (!value) return null;
  if (value.includes('harmonyos') || value.includes('hongmeng')) return null;
  if (value.includes('android')) return 'android';
  if (/\bios\b/.test(value) || value.includes('iphone') || value.includes('ipad')) return 'ios';
  if (value.includes('windows') || value.includes('win32')) return 'windows';
  if (value.includes('mac') || value.includes('darwin')) return 'macos';
  if (value.includes('linux')) return 'linux';
  return null;
}
