import { Tabs } from '@hospai/ui-kit';
import { Link } from 'react-router';

export function HousekeepingNav({ view }: { view:
    | 'board'
    | 'tasks'
    | 'inspections'
    | 'audit'
    | 'requests'
    | 'lost'
    | 'cases'
    | 'priority'
    | 'linen'
    | 'minibar'
    | 'amenities'
    | 'inventory' }) {
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
        to="/housekeeping/tasks"
        aria-current={view === 'tasks' ? 'page' : undefined}
      >
        Tasks
      </Link>
      <Link
        className="ui-tab"
        to="/housekeeping/inspections"
        aria-current={view === 'inspections' ? 'page' : undefined}
      >
        Inspections
      </Link>
      <Link
        className="ui-tab"
        to="/housekeeping/guest-audit"
        aria-current={view === 'audit' ? 'page' : undefined}
      >
        Guest audit
      </Link>
      <Link
        className="ui-tab"
        to="/housekeeping/requests"
        aria-current={view === 'requests' ? 'page' : undefined}
      >
        Requests
      </Link>
      <Link
        className="ui-tab"
        to="/housekeeping/lost-found"
        aria-current={view === 'lost' ? 'page' : undefined}
      >
        Lost &amp; found
      </Link>
      <Link
        className="ui-tab"
        to="/housekeeping/cases"
        aria-current={view === 'cases' ? 'page' : undefined}
      >
        Cases
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
        to="/housekeeping/linen"
        aria-current={view === 'linen' ? 'page' : undefined}
      >
        Linen
      </Link>
      <Link
        className="ui-tab"
        to="/housekeeping/minibar"
        aria-current={view === 'minibar' ? 'page' : undefined}
      >
        Minibar
      </Link>
      <Link
        className="ui-tab"
        to="/housekeeping/amenities"
        aria-current={view === 'amenities' ? 'page' : undefined}
      >
        Amenities
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
