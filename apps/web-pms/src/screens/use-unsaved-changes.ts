import { createElement, useContext, useEffect, type ReactNode } from 'react';
import { UNSAFE_DataRouterStateContext, useBlocker } from 'react-router';

function DataRouterBlocker({ dirty }: { dirty: boolean }) {
  useBlocker(dirty);
  return null;
}

/**
 * beforeunload always. useBlocker only inside a data router
 * (createBrowserRouter / createMemoryRouter). MemoryRouter and BrowserRouter
 * throw if useBlocker is called directly.
 */
export function useUnsavedChanges(dirty: boolean): ReactNode {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const inDataRouter = useContext(UNSAFE_DataRouterStateContext) != null;
  if (!inDataRouter) return null;
  return createElement(DataRouterBlocker, { dirty });
}
