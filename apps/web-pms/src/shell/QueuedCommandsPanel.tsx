import { useQuery } from '@tanstack/react-query';
import { queuedCommands } from '../client.js';

export function QueuedCommandsPanel() {
  const q = useQuery({
    queryKey: ['queued-commands'],
    queryFn: async () => [...queuedCommands.entries()],
    staleTime: 0,
    refetchInterval: 1000,
  });
  const entries = q.data ?? [];

  return (
    <section className="panel">
      <h2>Queued commands</h2>
      {entries.length === 0 ? (
        <p className="muted">None this session</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={`${e.commandId}-${e.idempotencyKey}`}>
              {e.commandId} · {e.idempotencyKey.slice(0, 8)}… · {e.businessDate ?? '—'}
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Session-scoped — lost on reload</p>
    </section>
  );
}
