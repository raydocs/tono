import type { OpsPersonView } from '../../lib/ops-views';
import { Empty, GlassCard } from '../../ui';
import { PersonRow } from './PersonRow';

export function CustomerList({
  people,
  selectedUserId,
  onOpen,
}: {
  people: OpsPersonView[];
  selectedUserId: string | null;
  onOpen: (userId: string) => void;
}) {
  if (people.length === 0) {
    return <GlassCard><Empty title="没有符合条件的客户" detail="换个筛选或清空搜索再看。" /></GlassCard>;
  }
  return (
    <div className="person-list">
      {people.map((person) => (
        <PersonRow
          key={person.userId}
          person={person}
          selected={selectedUserId === person.userId}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
