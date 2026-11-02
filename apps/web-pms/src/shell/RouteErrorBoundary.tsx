import { Alert, AlertTitle, Button } from '@hospai/ui-kit';
import { isRouteErrorResponse, useRouteError } from 'react-router';

/**
 * Data-router error fallback. Without it a thrown render error or an
 * unmatched top-level path shows React Router's developer page.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="main" data-testid="route-error">
      <Alert>
        <AlertTitle>{notFound ? 'Page not found' : 'Something went wrong'}</AlertTitle>
        {notFound
          ? 'That address does not match a page.'
          : 'This page could not be shown. Reload to try again.'}
      </Alert>
      <Button type="button" intent="primary" onClick={() => window.location.assign('/dashboard')}>
        Go to Dashboard
      </Button>
    </main>
  );
}
