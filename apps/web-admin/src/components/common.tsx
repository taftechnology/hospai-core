import { Alert, Button, EmptyState, Skeleton } from '@hospai/ui-kit';
import { opsErrorMessage } from '../api/client.js';

export function LoadingBlock({ label }: { label: string }) {
  return <Skeleton lines={4} label={label} />;
}

export function LoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <EmptyState
      kind="error"
      title="Could not load this"
      description={opsErrorMessage(error, 'Something went wrong while loading. Try again.')}
      action={<Button onClick={onRetry}>Try again</Button>}
    />
  );
}

export function Pager({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav className="ops-pager" aria-label="Pages">
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span>Page {page}</span>
      <Button disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

export function ReadOnlyNote() {
  return <Alert intent="informational">You have read-only access. Ask an ops admin to make changes.</Alert>;
}
