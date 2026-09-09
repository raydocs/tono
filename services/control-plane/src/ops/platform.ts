// Single os_version → platform mapping for flatten, releases, and customer
// projections. HarmonyOS / Hongmeng are recognised so they do not fall through
// to linux/android; they are not a catalog platform yet.

export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';

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
