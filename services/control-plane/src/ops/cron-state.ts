// `ops_cron_state` read/write for one-shot backfills that run inside a cron
// step rather than as a step of their own. Cron owns its own copies for the
// step watermarks it writes; these exist so a rollup module can keep its
// progress without reaching into cron.ts.

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

/** The watermark stored under `key`, or null when it was never written. */
export async function readCronState(db: D1Database, key: string): Promise<number | null> {
  try {
    const row = await db.prepare(
      'SELECT ran_at FROM ops_cron_state WHERE key = ?',
    ).bind(key).first<{ ran_at: number }>();
    return row ? Number(row.ran_at) : null;
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

export async function writeCronState(db: D1Database, key: string, value: number): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO ops_cron_state(key, ran_at) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET ran_at = excluded.ran_at`,
    ).bind(key, value).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}
