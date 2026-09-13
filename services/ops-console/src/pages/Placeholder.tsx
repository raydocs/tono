import { Empty } from '@/components/ops/Empty';
import { copy } from '@/copy/copy';

/**
 * Every page that has not been built yet. It exists as its own module so the
 * route split has something to split, and so the shell can be screenshotted
 * at a phone width before the real page lands.
 */
export function PlaceholderPage({ message = copy.emptyMigrated }: { message?: string }) {
  return (
    <div className="page-wrap">
      <Empty message={message} />
    </div>
  );
}

export default PlaceholderPage;
