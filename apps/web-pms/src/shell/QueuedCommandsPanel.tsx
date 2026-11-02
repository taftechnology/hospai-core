import { useQuery } from '@tanstack/react-query';
import { queuedCommands } from '../client.js';
import { queuedCommandLine } from '../copy/queued-command-line.js';
import { useFormat } from './PropertyFormat.js';

export function QueuedCommandsPanel() {
  const { fmt } = useFormat();
  const q = useQuery({
    queryKey: ['queued-commands'],
    queryFn: async () => [...queuedCommands.entries()],
    staleTime: 0,
    refetchInterval: (query) =>
      (query.state.data?.length ?? 0) > 0 ? 1000 : false,
  });
  const entries = q.data ?? [];
  // Shown only while something is queued, so the shell's footer row costs no height otherwise.
  if (entries.length === 0) return null;

  return (
    <details className="side-panel" open>
      <summary>Queued commands</summary>
      <ul>
        {entries.map((e) => (
          <li key={`${e.commandId}-${e.idempotencyKey}`}>
            {queuedCommandLine(e, fmt)}
          </li>
        ))}
      </ul>
      <p className="muted">Session-scoped — lost on reload</p>
    </details>
  );
}
