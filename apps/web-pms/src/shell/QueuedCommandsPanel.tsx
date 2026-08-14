import { useQuery } from '@tanstack/react-query';
import { queuedCommands } from '../client.js';
import { queuedCommandLine } from '../copy/queued-command-line.js';

export function QueuedCommandsPanel() {
  const q = useQuery({
    queryKey: ['queued-commands'],
    queryFn: async () => [...queuedCommands.entries()],
    staleTime: 0,
    refetchInterval: 1000,
  });
  const entries = q.data ?? [];

  return (
    <details className="side-panel" open={entries.length > 0}>
      <summary>Queued commands</summary>
      {entries.length > 0 ? (
        <ul>
          {entries.map((e) => (
            <li key={`${e.commandId}-${e.idempotencyKey}`}>
              {queuedCommandLine(e)}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="muted">Session-scoped — lost on reload</p>
    </details>
  );
}
