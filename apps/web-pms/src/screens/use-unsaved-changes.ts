import { Button, Dialog } from '@hospai/ui-kit';
import { createElement, Fragment, useContext, useEffect, useRef, type ReactNode } from 'react';
import { UNSAFE_DataRouterStateContext, useBlocker } from 'react-router';

function DataRouterBlocker({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(dirty);
  const stayRef = useRef<HTMLButtonElement>(null);

  if (blocker.state === 'blocked') {
    return createElement(
      Dialog,
      {
        open: true,
        title: 'Leave without saving?',
        onClose: () => blocker.reset(),
        initialFocus: stayRef,
        footer: createElement(
          Fragment,
          null,
          createElement(
            Button,
            {
              ref: stayRef,
              type: 'button',
              intent: 'default',
              onClick: () => blocker.reset(),
            },
            'Stay',
          ),
          createElement(
            Button,
            {
              type: 'button',
              intent: 'destructive',
              onClick: () => blocker.proceed(),
            },
            'Leave',
          ),
        ),
      },
      createElement('p', null, 'Your changes on this page will be lost.'),
    );
  }

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
