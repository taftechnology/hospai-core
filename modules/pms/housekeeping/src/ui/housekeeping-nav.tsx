import { Link } from 'react-router';

export function HousekeepingNav({ view }: { view: 'board' | 'priority' }) {
  return (
    <nav className="ui-tabs" aria-label="Housekeeping">
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
    </nav>
  );
}
