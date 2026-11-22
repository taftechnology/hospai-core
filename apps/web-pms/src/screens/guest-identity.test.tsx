import { ClassifiedError, FALLBACK_FORMAT, formatInstantDate } from '@hospai/client-core';
import { maskedDocumentNumber, type GuestPreferences } from '@hospai/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listGuestDocuments = vi.fn();
const readGuestDocument = vi.fn();
const addGuestDocument = vi.fn();
const attachGuestDocumentScan = vi.fn();
const getGuestDocumentScan = vi.fn();
const removeGuestDocument = vi.fn();
const getGuestConsent = vi.fn();
const getGuestSettings = vi.fn();
const updateGuest = vi.fn();
const updateGuestConsent = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    const classified = (err as { classified?: unknown }).classified;
    if (classified && typeof classified === 'object') return classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
  api: {
    listGuestDocuments: (...args: unknown[]) => listGuestDocuments(...args),
    readGuestDocument: (...args: unknown[]) => readGuestDocument(...args),
    addGuestDocument: (...args: unknown[]) => addGuestDocument(...args),
    attachGuestDocumentScan: (...args: unknown[]) => attachGuestDocumentScan(...args),
    getGuestDocumentScan: (...args: unknown[]) => getGuestDocumentScan(...args),
    removeGuestDocument: (...args: unknown[]) => removeGuestDocument(...args),
    getGuestConsent: (...args: unknown[]) => getGuestConsent(...args),
    getGuestSettings: (...args: unknown[]) => getGuestSettings(...args),
    updateGuest: (...args: unknown[]) => updateGuest(...args),
    updateGuestConsent: (...args: unknown[]) => updateGuestConsent(...args),
  },
}));

import {
  GuestDocumentBadges,
  GuestIdentityPanels,
  SelectedGuestDocument,
} from './guest-identity.js';

const recordedAt = Date.UTC(2026, 10, 20, 12);
const recordedLabel = formatInstantDate(recordedAt, FALLBACK_FORMAT);

const passport = {
  id: 'doc_1',
  kind: 'PASSPORT',
  hasScan: false,
  scanContentType: null,
  createdAt: recordedAt,
};

function renderPanels(preferences?: GuestPreferences) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GuestIdentityPanels
          propertyId="prop_demo"
          guestRef="g1"
          displayName="Ada Lovelace"
          preferences={preferences}
          canWrite
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe('guest identity panels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => '' });
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} });
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:scan');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    listGuestDocuments.mockResolvedValue({ ok: true, documents: [], requireIdAtCheckIn: false });
    getGuestConsent.mockResolvedValue({ ok: true, current: {}, history: [] });
    getGuestSettings.mockResolvedValue({
      ok: true,
      version: 1,
      value: { consentNoticeVersion: null, requireIdAtCheckIn: false },
    });
    addGuestDocument.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    attachGuestDocumentScan.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    removeGuestDocument.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    updateGuest.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    updateGuestConsent.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows an empty state, then a table, and records from a dialog that resets', async () => {
    const { invalidateSpy } = renderPanels();
    expect(await screen.findByText('No identity document recorded at this property.')).toBeTruthy();
    expect(screen.queryByTestId('guest-documents')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
    expect(screen.getByTestId('record-id-document')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Document kind'), { target: { value: 'AADHAAR' } });
    expect(screen.getByText(/last four digits only/)).toBeTruthy();
    expect(screen.queryByLabelText('Scan')).toBeNull();
    fireEvent.change(screen.getByLabelText('Document kind'), { target: { value: 'PASSPORT' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: 'ab123456' } });
    fireEvent.change(screen.getByLabelText('Issuing country'), { target: { value: 'IN' } });
    fireEvent.change(screen.getByLabelText('Nationality'), { target: { value: 'IN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record document' }));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['guest-documents', 'prop_demo', 'g1'] }),
    );
    expect(screen.queryByTestId('record-id-document')).toBeNull();
    expect(screen.getByText('Identity document recorded.')).toBeTruthy();
    expect(addGuestDocument).toHaveBeenCalledWith(
      'prop_demo',
      'g1',
      expect.objectContaining({
        kind: 'PASSPORT',
        fields: expect.objectContaining({ number: 'ab123456', issuingCountry: 'IN', nationality: 'IN' }),
      }),
      expect.stringMatching(/^guest-doc:prop_demo:g1:/),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
    expect((screen.getByLabelText('Number') as HTMLInputElement).value).toBe('');
  });

  it('lists kind, recorded date and scan, and views a masked Aadhaar without a scan input', async () => {
    listGuestDocuments.mockResolvedValue({
      ok: true,
      requireIdAtCheckIn: false,
      documents: [
        passport,
        {
          id: 'doc_aadhaar',
          kind: 'AADHAAR',
          hasScan: false,
          scanContentType: null,
          createdAt: recordedAt,
        },
      ],
    });
    readGuestDocument.mockResolvedValue({
      ok: true,
      id: 'doc_aadhaar',
      kind: 'AADHAAR',
      fields: { numberLast4: '1234' },
      hasScan: false,
      createdAt: recordedAt,
    });
    renderPanels();
    const table = await screen.findByTestId('guest-documents');
    expect(table.textContent).toContain('Passport');
    expect(table.textContent).toContain('Aadhaar');
    expect(table.textContent).toContain(recordedLabel);
    expect(table.textContent).toContain('No');
    const rowRemove = within(table).getAllByRole('button', { name: 'Remove' })[0]!;
    expect(rowRemove.className).not.toContain('ui-btn--destructive');

    fireEvent.click(within(table).getAllByRole('button', { name: 'View' })[1]!);
    expect(await screen.findByText(maskedDocumentNumber({ numberLast4: '1234' }))).toBeTruthy();
    expect(screen.queryByLabelText('Attach scan')).toBeNull();
    expect(screen.queryByLabelText('Replace scan')).toBeNull();
  });

  it('remove asks for a reason and invalidates the documents key', async () => {
    listGuestDocuments.mockResolvedValue({
      ok: true,
      requireIdAtCheckIn: false,
      documents: [passport],
    });
    const { invalidateSpy } = renderPanels();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = screen.getByTestId('remove-id-document');
    const confirm = within(dialog).getByRole('button', { name: 'Remove' });
    expect(confirm.className).toContain('ui-btn--destructive');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Replaced' } });
    expect((within(dialog).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['guest-documents', 'prop_demo', 'g1'] }),
    );
    expect(removeGuestDocument).toHaveBeenCalledWith(
      'prop_demo',
      'g1',
      'doc_1',
      'Replaced',
      expect.stringMatching(/^guest-doc-remove:doc_1:/),
    );
    expect(screen.getByText('Identity document removed.')).toBeTruthy();
  });

  it('views an image scan and revokes the blob URL on close', async () => {
    listGuestDocuments.mockResolvedValue({
      ok: true,
      requireIdAtCheckIn: false,
      documents: [{ ...passport, hasScan: true, scanContentType: 'image/jpeg' }],
    });
    readGuestDocument.mockResolvedValue({
      ok: true,
      id: 'doc_1',
      kind: 'PASSPORT',
      fields: { number: 'AB123456', issuingCountry: 'IN', expiryDate: '2030-01-15' },
      hasScan: true,
      createdAt: recordedAt,
    });
    getGuestDocumentScan.mockResolvedValue({
      ok: true,
      bytes: Uint8Array.from([1, 2, 3]),
      contentType: 'image/jpeg',
    });
    renderPanels();
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    const image = await screen.findByRole('img', { name: 'Identity document' });
    expect(image.getAttribute('src')).toBe('blob:scan');
    expect(screen.getByText('15 Jan 2030')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('view-id-document'), { key: 'Escape' });
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:scan'));
    expect(screen.queryByTestId('view-id-document')).toBeNull();
  });

  it('closes the identity document view when Close is clicked', async () => {
    listGuestDocuments.mockResolvedValue({
      ok: true,
      requireIdAtCheckIn: false,
      documents: [passport],
    });
    readGuestDocument.mockResolvedValue({
      ok: true,
      id: 'doc_1',
      kind: 'PASSPORT',
      fields: { number: 'AB123456', issuingCountry: 'IN' },
      hasScan: false,
      createdAt: recordedAt,
    });
    renderPanels();
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    const dialog = await screen.findByTestId('view-id-document');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('view-id-document')).toBeNull());
  });

  it('offers a PDF download and attaches a replacement scan', async () => {
    listGuestDocuments.mockResolvedValue({
      ok: true,
      requireIdAtCheckIn: false,
      documents: [{ ...passport, hasScan: true, scanContentType: 'application/pdf' }],
    });
    readGuestDocument.mockResolvedValue({
      ok: true,
      id: 'doc_1',
      kind: 'PASSPORT',
      fields: { number: 'AB123456', issuingCountry: 'IN' },
      hasScan: true,
      createdAt: recordedAt,
    });
    getGuestDocumentScan.mockResolvedValue({
      ok: true,
      bytes: Uint8Array.from([1, 2, 3]),
      contentType: 'application/pdf',
    });
    const { invalidateSpy } = renderPanels();
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    const download = await screen.findByRole('button', { name: 'Download' });
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(download);
    expect(URL.createObjectURL).toHaveBeenCalled();
    const file = new File([Uint8Array.from([9])], 'id.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Replace scan'), { target: { files: [file] } });
    await waitFor(() => expect(attachGuestDocumentScan).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['guest-document-scan', 'prop_demo', 'g1', 'doc_1'],
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['guest-documents', 'prop_demo', 'g1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['guest-document', 'prop_demo', 'g1', 'doc_1'],
    });
  });

  it('shows a load error instead of the empty state', async () => {
    listGuestDocuments.mockRejectedValue(
      new ClassifiedError({ class: 'server_error', status: 500, body: {}, retryAfterMs: null }),
    );
    renderPanels();
    expect(await screen.findByText('Could not load identity documents.')).toBeTruthy();
    expect(screen.queryByText('No identity document recorded at this property.')).toBeNull();
  });

  it('shows saved preference badges above the checkboxes', async () => {
    renderPanels({ room: ['HIGH_FLOOR'], dietary: ['VEGAN'] });
    const badges = await screen.findByTestId('guest-preference-badges');
    expect(badges.textContent).toContain('High floor');
    expect(badges.textContent).toContain('Vegan');
    const checkbox = screen.getByRole('checkbox', { name: 'High floor' });
    expect(badges.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('writes consent status, notice version and recorded date', async () => {
    getGuestSettings.mockResolvedValue({
      ok: true,
      version: 1,
      value: { consentNoticeVersion: '2026-11', requireIdAtCheckIn: false },
    });
    getGuestConsent.mockResolvedValue({
      ok: true,
      current: {
        MARKETING_EMAIL: { status: 'GRANTED', source: 'DESK', noticeVersion: '2026-11', recordedAt },
      },
      history: [
        {
          id: 'c_here',
          purpose: 'MARKETING_EMAIL',
          status: 'GRANTED',
          source: 'DESK',
          noticeVersion: '2026-11',
          recordedAt,
          recordedHere: true,
        },
        {
          id: 'c_there',
          purpose: 'MARKETING_SMS',
          status: 'WITHDRAWN',
          source: 'PHONE',
          noticeVersion: '2026-11',
          recordedAt,
          recordedHere: false,
        },
      ],
    });
    const { invalidateSpy } = renderPanels();
    expect(
      await screen.findByText(`Marketing email: Granted · notice 2026-11 · ${recordedLabel}`),
    ).toBeTruthy();
    expect(screen.getByText('Marketing SMS: Not recorded')).toBeTruthy();
    expect(
      screen.getByText(
        `Marketing email: Granted · notice 2026-11 · ${recordedLabel} · Recorded at this property`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Marketing SMS: Withdrawn · notice 2026-11 · ${recordedLabel} · Recorded at another property in your group`,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Grant' }));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['guest-consent', 'prop_demo', 'g1'] }),
    );
  });
});

describe('identity summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listGuestDocuments.mockResolvedValue({ ok: true, documents: [], requireIdAtCheckIn: false });
  });

  afterEach(() => cleanup());

  function renderBadge() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <GuestDocumentBadges propertyId="prop_demo" guestRef="g1" />
      </QueryClientProvider>,
    );
  }

  it('says No ID on file when the list is empty and ID on file when a document exists', async () => {
    renderBadge();
    expect((await screen.findByTestId('id-on-file')).textContent).toBe('No ID on file');
    cleanup();
    listGuestDocuments.mockResolvedValue({
      ok: true,
      requireIdAtCheckIn: true,
      documents: [passport],
    });
    renderBadge();
    expect((await screen.findByTestId('id-on-file')).textContent).toBe('ID on file');
  });

  it('renders the selected document inside Identity on file, and nothing without one', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <SelectedGuestDocument propertyId="prop_demo" guestRef="g1" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(listGuestDocuments).toHaveBeenCalled());
    expect(screen.queryByText('Identity on file')).toBeNull();

    listGuestDocuments.mockResolvedValue({
      ok: true,
      requireIdAtCheckIn: false,
      documents: [passport],
    });
    readGuestDocument.mockResolvedValue({
      ok: true,
      id: 'doc_1',
      kind: 'PASSPORT',
      fields: { number: 'AB123456', issuingCountry: 'IN', expiryDate: '2030-01-15' },
      hasScan: false,
      createdAt: recordedAt,
    });
    rerender(
      <QueryClientProvider client={client}>
        <SelectedGuestDocument propertyId="prop_b" guestRef="g2" />
      </QueryClientProvider>,
    );
    const block = await screen.findByTestId('selected-guest-document');
    expect(block.textContent).toContain('Identity on file');
    expect(block.textContent).toContain(maskedDocumentNumber({ number: 'AB123456' }));
    expect(block.textContent).toContain('expires 15 Jan 2030');
  });
});
