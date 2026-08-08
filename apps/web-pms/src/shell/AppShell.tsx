import { NavLink, Outlet } from 'react-router';
import { ExceptionsPanel } from '../screens/ExceptionsPanel.js';
import { NAV_ENTRIES } from './nav.js';
import { PropertyTimeZoneProvider } from './PropertyTimeZone.js';
import { QueuedCommandsPanel } from './QueuedCommandsPanel.js';
import { ShiftStrip } from './ShiftStrip.js';

export function AppShell() {
  return (
    <PropertyTimeZoneProvider>
      <div className="app-shell">
        <header className="top-bar">
          <strong>HospAI</strong>
          <nav className="nav" aria-label="Front desk">
            {NAV_ENTRIES.map((entry) => (
              <NavLink key={entry.id} to={entry.path} end>
                {entry.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <ShiftStrip />
        <main className="main">
          <Outlet />
        </main>
        <div className="side-panels">
          <QueuedCommandsPanel />
          <ExceptionsPanel />
        </div>
      </div>
    </PropertyTimeZoneProvider>
  );
}
