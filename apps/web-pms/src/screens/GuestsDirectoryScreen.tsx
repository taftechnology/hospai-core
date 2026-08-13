import { ClassifiedError } from '@hospai/client-core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, asClassified, tenant } from '../client.js';

type GuestProfile = { displayName: string; email?: string; phone?: string };
type GuestDirItem = {
  guestId: string;
  erased: false;
  profile: GuestProfile;
  createdAt: number;
};

function asGuestPage(result: unknown): { items: GuestDirItem[]; nextCursor: string | null } {
  if (!result || typeof result !== 'object') return { items: [], nextCursor: null };
  const rec = result as {
    body?: { items?: unknown; nextCursor?: unknown };
    items?: unknown;
    nextCursor?: unknown;
  };
  const page = Array.isArray(rec.items) ? rec : rec.body;
  const raw = Array.isArray(page?.items) ? page.items : [];
  const items = raw.filter((row): row is GuestDirItem => {
    if (!row || typeof row !== 'object') return false;
    const r = row as { guestId?: unknown; profile?: { displayName?: unknown } };
    return typeof r.guestId === 'string' && typeof r.profile?.displayName === 'string';
  });
  const next = page && typeof page === 'object' ? (page as { nextCursor?: unknown }).nextCursor : null;
  return { items, nextCursor: typeof next === 'string' ? next : null };
}

function formatCreated(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(createdAt));
}

export function GuestsDirectoryScreen() {
  const propertyId = tenant.propertyId;
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const cursor = params.get('cursor');
  const [draft, setDraft] = useState(q);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = draft.trim();
      if (next === q) return;
      const sp = new URLSearchParams();
      if (next) sp.set('q', next);
      setParams(sp, { replace: true });
    }, 300);
    return () => window.clearTimeout(t);
  }, [draft, q, setParams]);

  const listQ = useQuery({
    queryKey: ['guests-directory', propertyId, q, cursor],
    queryFn: async () => {
      if (q) {
        return api.searchGuests(propertyId, {
          q,
          ...(cursor ? { cursor } : {}),
        });
      }
      return api.listGuests(propertyId, cursor ? { cursor } : undefined);
    },
  });

  const page = asGuestPage(listQ.data);
  const failClosed =
    listQ.isError &&
    (asClassified(listQ.error).class === 'fail_closed' || listQ.error instanceof ClassifiedError);

  let results: ReactNode;
  if (failClosed) {
    results = (
      <p className="error" role="alert">
        Guest directory unavailable — organization unreachable.
      </p>
    );
  } else if (listQ.isLoading) {
    results = <p className="muted">Loading…</p>;
  } else if (page.items.length === 0) {
    results = <p className="muted">{q ? 'No guests match that search.' : 'No guests yet.'}</p>;
  } else {
    results = (
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {page.items.map((row) => (
            <tr key={row.guestId}>
              <td className="min-w-0 truncate">
                <Link
                  to={`/guests/${encodeURIComponent(row.guestId)}`}
                  data-testid="guest-profile-link"
                >
                  {row.profile.displayName}
                </Link>
                <div translate="no" className="muted truncate" title={row.guestId}>
                  {row.guestId}
                </div>
              </td>
              <td className="min-w-0 truncate">{row.profile.email ?? ''}</td>
              <td className="min-w-0 truncate">{row.profile.phone ?? ''}</td>
              <td className="tabular-nums">{formatCreated(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function goNext() {
    if (!page.nextCursor) return;
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    sp.set('cursor', page.nextCursor);
    setParams(sp);
  }

  return (
    <div>
      <header className="board-header">
        <h1 className="board-title text-wrap-balance">Guests</h1>
        <label>
          Name, email, or phone{' '}
          <input
            role="search"
            type="search"
            name="guest-search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Ada Lovelace, ada@…, or 5550100…"
            data-testid="guest-directory-search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
      </header>
      <div className="panel" aria-live="polite">
        {results}
        {page.nextCursor ? (
          <button type="button" onClick={goNext}>
            Next
          </button>
        ) : null}
      </div>
    </div>
  );
}
