import { Card, CardContent, EmptyState, PageHeader } from '@hospai/ui-kit';
import { Link, useLocation } from 'react-router';

/** Any path inside the shell that no route matches. */
export function NotFoundScreen() {
  const { pathname } = useLocation();
  return (
    <section data-testid="not-found-screen">
      <PageHeader title="Page not found" />
      <Card>
        <CardContent>
          <EmptyState
            kind="nomatch"
            title={`Nothing lives at ${pathname}.`}
            description="Check the address, or go back to the dashboard."
            action={
              <Link className="ui-link-btn ui-link-btn--primary" to="/dashboard">
                Go to Dashboard
              </Link>
            }
          />
        </CardContent>
      </Card>
    </section>
  );
}
