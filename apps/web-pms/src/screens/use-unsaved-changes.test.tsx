import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useNavigate } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useUnsavedChanges } from './use-unsaved-changes.js';

let nativeRequest: typeof Request | undefined;

beforeAll(() => {
  nativeRequest = globalThis.Request;
  if (typeof nativeRequest !== 'function') return;
  globalThis.Request = class Request extends nativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.signal) {
        const { signal: _ignored, ...rest } = init;
        super(input, rest);
        return;
      }
      super(input, init);
    }
  } as typeof Request;
});

// jsdom's AbortSignal is not undici's, so data-router navigation rejects without this.
afterAll(() => {
  if (nativeRequest) globalThis.Request = nativeRequest;
});

function GoAwayButton() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="go-away" onClick={() => navigate('/away')}>
      Go away
    </button>
  );
}

function DirtyPage({ dirty }: { dirty: boolean }) {
  const guard = useUnsavedChanges(dirty);
  return (
    <div>
      <h1>Editor</h1>
      <GoAwayButton />
      {guard}
    </div>
  );
}

describe('useUnsavedChanges', () => {
  afterEach(() => {
    cleanup();
  });

  it('returns null under MemoryRouter without throwing', () => {
    expect(() =>
      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<DirtyPage dirty />} />
          </Routes>
        </MemoryRouter>,
      ),
    ).not.toThrow();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dirty navigation opens the dialog and Stay keeps the page', async () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <DirtyPage dirty /> },
        { path: '/away', element: <h1>Away</h1> },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByTestId('go-away'));
    expect(await screen.findByRole('dialog', { name: /Leave without saving/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeTruthy();
  });

  it('clean navigation lands on the away page with no dialog', async () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <DirtyPage dirty={false} /> },
        { path: '/away', element: <h1>Away</h1> },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('go-away'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Away' })).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dirty Leave proceeds to the away page', async () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <DirtyPage dirty /> },
        { path: '/away', element: <h1>Away</h1> },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByTestId('go-away'));
    expect(await screen.findByRole('dialog', { name: /Leave without saving/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Away' })).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
