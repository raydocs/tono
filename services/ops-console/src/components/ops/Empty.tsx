import { copy } from '@/copy/copy';

export function Empty({ message = copy.emptyMigrated }: { message?: string }) {
  return (
    <div
      className="flex min-h-[240px] items-center justify-center rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-8 py-12"
      role="status"
    >
      <p className="text-body text-[var(--muted-foreground)]">{message}</p>
    </div>
  );
}
