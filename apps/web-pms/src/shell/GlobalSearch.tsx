import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Input, Popover, Skeleton } from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import { SearchIcon } from './icons.js';
import { useFormat } from './PropertyFormat.js';

type SearchHit = {
  reservationId: string;
  displayName?: string | null;
  roomCode?: string | null;
  status?: string;
  arrivalDate?: string;
  departureDate?: string;
};

function searchItems(result: unknown): SearchHit[] {
  if (!result || typeof result !== 'object') return [];
  const rec = result as { body?: { items?: unknown }; items?: unknown };
  const raw = Array.isArray(rec.items)
    ? rec.items
    : Array.isArray(rec.body?.items)
      ? rec.body.items
      : [];
  return raw.filter(
    (row): row is SearchHit =>
      Boolean(row) &&
      typeof row === 'object' &&
      typeof (row as SearchHit).reservationId === 'string',
  );
}

function shortcutHint(): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘K' : 'Ctrl K';
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const { dateRange } = useFormat();
  const propertyId = tenant.propertyId;
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setDismissed(false);
  }, [q]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return;
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const searchQ = useQuery({
    queryKey: ['reservation-search', propertyId, debounced],
    queryFn: () => api.searchDesk(propertyId, debounced),
    enabled: debounced.length > 0,
    retry: false,
  });

  const trimmed = q.trim();
  const waiting = trimmed.length > 0 && trimmed !== debounced;
  const items =
    !waiting && searchQ.isSuccess ? searchItems(searchQ.data) : [];
  const itemKey = items.map((hit) => hit.reservationId).join('\0');

  useEffect(() => {
    setActive(itemKey.length > 0 ? 0 : -1);
  }, [itemKey]);

  const panelOpen = trimmed.length > 0 && !dismissed;
  const failClosed =
    !waiting && searchQ.isError && asClassified(searchQ.error).class === 'fail_closed';
  const otherError = !waiting && searchQ.isError && !failClosed;
  const pending = panelOpen && (waiting || searchQ.isPending);
  const empty = panelOpen && !pending && !searchQ.isError && searchQ.isSuccess && items.length === 0;

  function optionId(index: number): string {
    return `${listId}-opt-${index}`;
  }

  function goFolio(id: string) {
    // The panel is not tied to focus, so clear it or it stays open over the folio.
    setQ('');
    setDebounced('');
    inputRef.current?.blur();
    void navigate(`/folio/${encodeURIComponent(id)}`);
  }

  function openHit(index: number) {
    const hit = items[index];
    if (!hit) return;
    goFolio(hit.reservationId);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape' && panelOpen) {
      e.preventDefault();
      setDismissed(true);
      return;
    }
    if (!panelOpen || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter') {
      const index = active >= 0 ? active : items.length === 1 ? 0 : -1;
      if (index < 0) return;
      e.preventDefault();
      openHit(index);
    }
  }

  return (
    <div className="global-search">
      <span className="global-search__icon">
        <SearchIcon size={14} />
      </span>
      <Input
        ref={inputRef}
        data-testid="reservation-search"
        type="search"
        role="combobox"
        aria-label="Guest name, room or booking ID"
        aria-expanded={panelOpen}
        aria-controls={items.length > 0 ? listId : undefined}
        aria-activedescendant={active >= 0 && items[active] ? optionId(active) : undefined}
        placeholder="Guest name, room or booking ID"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {q.length === 0 && !focused ? (
        <span className="global-search__hint">{shortcutHint()}</span>
      ) : null}
      <Popover
        open={panelOpen}
        onClose={() => setDismissed(true)}
        anchorRef={inputRef}
        label="Stay search results"
        returnFocus={false}
        data-testid="reservation-search-results"
      >
        <div className="global-search-panel">
          {pending ? <Skeleton label="Searching stays" lines={3} /> : null}
          {failClosed ? <p>Search unavailable — property unreachable.</p> : null}
          {otherError ? <p>{classifiedUserMessage(asClassified(searchQ.error), {})}</p> : null}
          {empty ? (
            <p>
              No stay matches “{trimmed}”. Try a full name, room number or booking ID.
            </p>
          ) : null}
          {items.length > 0 ? (
            <ul id={listId} role="listbox">
              {items.map((hit, index) => {
                const name = hit.displayName ? hit.displayName : 'Guest unavailable';
                const room = hit.roomCode ? hit.roomCode : 'Unassigned';
                const status = hit.status ? reservationStatusLabel(hit.status) : '';
                const dates =
                  hit.arrivalDate && hit.departureDate
                    ? dateRange(hit.arrivalDate, hit.departureDate)
                    : '';
                return (
                  <li key={hit.reservationId}>
                    <div
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === active}
                      className={
                        index === active
                          ? 'global-search-row global-search-row--active'
                          : 'global-search-row'
                      }
                      onClick={() => goFolio(hit.reservationId)}
                    >
                      <span className="global-search-row__name">{name}</span>
                      <span className="global-search-row__meta">
                        {room}
                        {status ? ` · ${status}` : ''}
                        {dates ? ` · ${dates}` : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}
