import { Tabs } from '@hospai/ui-kit';
import { Link } from 'react-router';

export function HousekeepingNav({ view }: { view: 'board' | 'priority' | 'inventory' }) {
  return (
    <Tabs label="Housekeeping">
      <Link
        className="ui-tab"
        to="/housekeeping"
        aria-current={view === 'board' ? 'page' : undefined}
      >
        Board
      </Link>
      <Link
        className="ui-tab"
        to="/housekeeping/priority"
        aria-current={view === 'priority' ? 'page' : undefined}
      >
        Priority
      </Link>
      <Link
        className="ui-tab"
        to="/housekeeping/inventory"
        aria-current={view === 'inventory' ? 'page' : undefined}
      >
        Inventory
      </Link>
    </Tabs>
  );
}
