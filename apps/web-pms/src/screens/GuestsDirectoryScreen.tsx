import { ClassifiedError } from '@hospai/client-core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  PageHeader,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';

type GuestProfile = { displayName: string; email?: string; phone?: string; vip?: boolean };
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

function displayGuestField(value?: string): ReactNode {
  const normalized = value?.trim();
  return normalized ? normalized : <span className="muted">—</span>;
}

export function GuestsDirectoryScreen() {
  const propertyId = tenant.propertyId;
  const { instantDate } = useFormat();
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
  const { subtitle } = usePropertySubtitle('Guest directory');

  let results: ReactNode;
  if (failClosed) {
    results = <Alert>Guest directory unavailable — organization unreachable.</Alert>;
  } else if (listQ.isLoading) {
    results = <p className="muted">Loading…</p>;
  } else if (page.items.length === 0) {
    results = <p className="muted">{q ? 'No guests match that search.' : 'No guests yet.'}</p>;
  } else {
    results = (
      <DataTable>
        <DataTableHead>
          <DataTableRow>
            <DataTableHeaderCell>Name</DataTableHeaderCell>
            <DataTableHeaderCell>Email</DataTableHeaderCell>
            <DataTableHeaderCell>Phone</DataTableHeaderCell>
            <DataTableHeaderCell>Created</DataTableHeaderCell>
          </DataTableRow>
        </DataTableHead>
        <DataTableBody>
          {page.items.map((row) => (
            <DataTableRow key={row.guestId}>
              <DataTableCell>
                <span className="guest-directory__name-row">
                  <Link
                    to={`/guests/${encodeURIComponent(row.guestId)}`}
                    className="guest-directory__name"
                    data-testid="guest-profile-link"
                  >
                    {row.profile.displayName}
                  </Link>
                  {row.profile.vip ? <Badge rung="attention">VIP</Badge> : null}
                </span>
                <div translate="no" className="muted truncate" title={row.guestId}>
                  {row.guestId}
                </div>
              </DataTableCell>
              <DataTableCell>{displayGuestField(row.profile.email)}</DataTableCell>
              <DataTableCell>{displayGuestField(row.profile.phone)}</DataTableCell>
              <DataTableCell>{instantDate(row.createdAt)}</DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    );
  }

  const hasTable = !failClosed && !listQ.isLoading && page.items.length > 0;

  function goNext() {
    if (!page.nextCursor) return;
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    sp.set('cursor', page.nextCursor);
    setParams(sp);
  }

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Guests"
        subtitle={subtitle}
        actions={
          <div className="guest-directory__actions">
            <Field
              size="lg"
              label={<span className="ui-visually-hidden">Name, email, or phone</span>}
              control={
                <Input
                  type="search"
                  name="guest-search"
                  autoComplete="off"
                  placeholder="Ada Lovelace, ada@…, or 5550100…"
                  data-testid="guest-directory-search"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              }
            />
            <Link className="ui-link-btn ui-link-btn--primary" to="/book">
              New booking
            </Link>
          </div>
        }
      />
      <div aria-live="polite">
        <Card>
          <CardHeader>
            <CardTitle>All guests</CardTitle>
            <Badge rung="neutral">
              {page.items.length} {page.items.length === 1 ? 'profile' : 'profiles'}
            </Badge>
          </CardHeader>
          <CardContent flush>
            <div className={hasTable ? undefined : 'guest-directory__state'}>{results}</div>
            {page.nextCursor ? (
              <div className="guest-directory__pagination">
                <Button type="button" onClick={goNext}>
                  Next
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
