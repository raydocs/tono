import type { OpsPersonView } from '../../lib/ops-views';
import { Empty } from '../../ui';
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
    return <Empty title="没有符合条件的客户" />;
  }
  return (
    <div className="person-list">
      {people.map((person) => (
        <PersonRow
          key={person.userId}
          person={person}
          selected={selectedUserId === person.userId}
          onOpen={() => onOpen(person.userId)}
        />
      ))}
    </div>
  );
}
