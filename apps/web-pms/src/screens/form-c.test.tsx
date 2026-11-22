import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getProperty = vi.fn();
const getMe = vi.fn();
const getReservationFormC = vi.fn();
const getFormCRegister = vi.fn();
const getFormCPerson = vi.fn();
const saveFormCPerson = vi.fn();
const markFormCFiled = vi.fn();
const removeFormCPerson = vi.fn();
const listGuestDocuments = vi.fn();
const readGuestDocument = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
  api: {
    getProperty: (...a: unknown[]) => getProperty(...a),
    getMe: (...a: unknown[]) => getMe(...a),
    getReservationFormC: (...a: unknown[]) => getReservationFormC(...a),
    getFormCRegister: (...a: unknown[]) => getFormCRegister(...a),
    getFormCPerson: (...a: unknown[]) => getFormCPerson(...a),
    saveFormCPerson: (...a: unknown[]) => saveFormCPerson(...a),
    markFormCFiled: (...a: unknown[]) => markFormCFiled(...a),
    removeFormCPerson: (...a: unknown[]) => removeFormCPerson(...a),
    listGuestDocuments: (...a: unknown[]) => listGuestDocuments(...a),
    readGuestDocument: (...a: unknown[]) => readGuestDocument(...a),
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import {
  FormCOverdueAlert,
  FormCPanel,
  emptyFormCForm,
  formCFieldsFromForm,
  formCFormFromFields,
  formCReady,
  invalidateFormC,
  prefillFromDocuments,
} from './form-c.js';
import { FormCScreen } from './FormCScreen.js';

const DAY = 24 * 60 * 60 * 1000;

function row(overrides: Record<string, unknown> = {}) {
  return {
    recordId: 'fcb_res_1',
    reservationId: 'res_1',
    kind: 'BOOKED_GUEST',
    status: 'TO_FILE',
    detailsSaved: false,
    deadlineAt: Date.now() + DAY,
    overdue: false,
    filedReference: null,
    filedAt: null,
    displayName: null,
    nationality: null,
    ...overrides,
  };
}

const writeMe = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_x',
  role: 'staff' as const,
  permissions: ['guests:read', 'guests:write', 'property:read'] as const,
  orgPermissions: [] as const,
};
const readOnlyMe = { ...writeMe, permissions: ['guests:read', 'property:read'] as const };

function renderWith(ui: React.ReactElement, path = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/form-c" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidateSpy };
}

function invalidatedKeys(spy: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }) {
  return spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
}

function india(applicable = true) {
  getProperty.mockResolvedValue({
    property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Harbor Inn' },
    formCApplicable: applicable,
  });
}

describe('Form C form helpers', () => {
  it('prefill maps passport and visa document fields into the dialog fields only', () => {
    const mapped = prefillFromDocuments(
      {
        number: 'ZZ1234567',
        issuingCountry: 'ZA',
        nationality: 'ZA',
        dateOfBirth: '1990-04-01',
        issueDate: '2020-01-02',
        expiryDate: '2030-01-01',
        placeOfIssue: 'Pretoria',
      },
      { number: 'V998877', issuingCountry: 'IN', visaType: 'Tourist', issueDate: '2026-10-01', expiryDate: '2027-04-01', placeOfIssue: 'Johannesburg' },
    );
    expect(mapped).toEqual({
      passportNumber: 'ZZ1234567',
      nationality: 'ZA',
      dateOfBirth: '1990-04-01',
      passportIssueDate: '2020-01-02',
      passportExpiryDate: '2030-01-01',
      passportPlaceOfIssue: 'Pretoria',
      visaNumber: 'V998877',
      visaType: 'Tourist',
      visaIssueDate: '2026-10-01',
      visaExpiryDate: '2027-04-01',
      visaPlaceOfIssue: 'Johannesburg',
    });
    expect(prefillFromDocuments(null, null)).toEqual({});
  });

  it('round-trips fields through the form and requires the portal minimum', () => {
    const form = emptyFormCForm();
    expect(formCReady(form)).toBe(false);
    form.surname = ' Mokoena ';
    form.gender = 'F';
    form.dateOfBirth = '1990-04-01';
    form.nationality = 'za';
    form.passportNumber = 'zz1';
    expect(formCReady(form)).toBe(true);
    form.employedInIndia = 'no';
    expect(formCFieldsFromForm(form)).toEqual({
      surname: 'Mokoena',
      gender: 'F',
      dateOfBirth: '1990-04-01',
      nationality: 'za',
      passportNumber: 'zz1',
      employedInIndia: false,
    });
    expect(
      formCFormFromFields({
        surname: 'Mokoena',
        gender: 'M',
        dateOfBirth: '1990-04-01',
        nationality: 'ZA',
        passportNumber: 'ZZ1',
        employedInIndia: true,
      }),
    ).toMatchObject({ surname: 'Mokoena', gender: 'M', employedInIndia: 'yes', givenNames: '' });
  });

  it('invalidates the stay key and the register prefix', () => {
    const seen: unknown[] = [];
    invalidateFormC({ invalidateQueries: (f: unknown) => (seen.push(f), Promise.resolve()) } as never, 'prop_1', 'res_1');
    expect(seen).toEqual([
      { queryKey: ['reservation-form-c', 'prop_1', 'res_1'] },
      { queryKey: ['form-c-register', 'prop_1'] },
    ]);
  });
});

describe('Form C panel on the stay card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    india();
    getMe.mockResolvedValue(writeMe);
    getReservationFormC.mockResolvedValue({ ok: true, rows: [row()] });
    listGuestDocuments.mockResolvedValue({ ok: true, documents: [], requireIdAtCheckIn: false });
    saveFormCPerson.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    markFormCFiled.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    removeFormCPerson.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
  });
  afterEach(() => cleanup());

  const panel = (status = 'checked_in') => (
    <FormCPanel reservationId="res_1" guestRef="g1" stayStatus={status} />
  );

  it('renders only for an India property', async () => {
    india(false);
    renderWith(panel());
    await waitFor(() => expect(getProperty).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Form C')).toBeNull();
    expect(getReservationFormC).not.toHaveBeenCalled();
  });

  it('lists the stay rows with name, kind, deadline and status words', async () => {
    getReservationFormC.mockResolvedValue({
      ok: true,
      rows: [
        row(),
        row({
          recordId: 'fca_2',
          kind: 'ADDITIONAL',
          detailsSaved: true,
          displayName: 'Thabo Ndlovu',
          nationality: 'ZA',
          overdue: true,
          deadlineAt: Date.now() - 1000,
        }),
        row({
          recordId: 'fca_3',
          kind: 'ADDITIONAL',
          status: 'FILED',
          detailsSaved: true,
          displayName: 'Sipho Dube',
          nationality: 'ZA',
          filedReference: 'FC-0042',
        }),
      ],
    });
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-panel-table')).toBeTruthy());
    const first = screen.getByTestId('form-c-row-fcb_res_1');
    expect(within(first).getByText('Details needed')).toBeTruthy();
    expect(within(first).getByText('Booked guest')).toBeTruthy();
    expect(within(first).getByText('To file')).toBeTruthy();
    const second = screen.getByTestId('form-c-row-fca_2');
    expect(within(second).getByText('Thabo Ndlovu')).toBeTruthy();
    expect(within(second).getByText('Overdue')).toBeTruthy();
    expect(within(second).getByText('Additional guest')).toBeTruthy();
    const third = screen.getByTestId('form-c-row-fca_3');
    expect(within(third).getByText('Filed')).toBeTruthy();
    expect(within(third).getByText('FC-0042')).toBeTruthy();
    expect(within(third).queryByText('Remove')).toBeNull();
    expect(within(third).queryByText('Mark filed')).toBeNull();
  });

  it('has three different states: empty, error, rows', async () => {
    getReservationFormC.mockResolvedValue({ ok: true, rows: [] });
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-panel-empty')).toBeTruthy());
    cleanup();
    getReservationFormC.mockRejectedValue(
      new ClassifiedError({ class: 'fail_closed', status: 503, body: {}, retryAfterMs: null }),
    );
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-panel-error').textContent).toBe('Property unreachable.'));
  });

  it('disables Add on a stay that is not checked in and says why; hides writes without guests:write', async () => {
    renderWith(panel('confirmed'));
    await waitFor(() => expect(screen.getByTestId('form-c-add')).toBeTruthy());
    expect((screen.getByTestId('form-c-add') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('A person can be added while the guest is checked in.')).toBeTruthy();
    cleanup();
    getMe.mockResolvedValue(readOnlyMe);
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-panel-table')).toBeTruthy());
    expect(screen.queryByTestId('form-c-add')).toBeNull();
    expect(screen.queryByTestId('form-c-edit-fcb_res_1')).toBeNull();
    expect(screen.queryByTestId('form-c-remove-fcb_res_1')).toBeNull();
  });

  it('prefills the booked guest dialog from the passport and visa on file, then saves and refreshes', async () => {
    listGuestDocuments.mockResolvedValue({
      ok: true,
      documents: [
        { id: 'doc_v', kind: 'VISA', hasScan: false, scanContentType: null, createdAt: 3 },
        { id: 'doc_p', kind: 'PASSPORT', hasScan: false, scanContentType: null, createdAt: 2 },
        { id: 'doc_old', kind: 'PASSPORT', hasScan: false, scanContentType: null, createdAt: 1 },
      ],
      requireIdAtCheckIn: false,
    });
    readGuestDocument.mockImplementation(async (_p: string, _g: string, id: string) => {
      if (id === 'doc_p') {
        return {
          ok: true,
          id,
          kind: 'PASSPORT',
          fields: { number: 'ZZ1234567', issuingCountry: 'ZA', nationality: 'ZA', dateOfBirth: '1990-04-01' },
        };
      }
      return {
        ok: true,
        id,
        kind: 'VISA',
        fields: { number: 'V998877', issuingCountry: 'IN', nationality: 'ZA', visaType: 'Tourist' },
      };
    });
    const { invalidateSpy } = renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-edit-fcb_res_1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('form-c-edit-fcb_res_1'));
    await waitFor(() =>
      expect((screen.getByTestId('form-c-passportNumber') as HTMLInputElement).value).toBe('ZZ1234567'),
    );
    expect((screen.getByTestId('form-c-nationality') as HTMLInputElement).value).toBe('ZA');
    expect((screen.getByTestId('form-c-dateOfBirth') as HTMLInputElement).value).toBe('1990-04-01');
    expect((screen.getByTestId('form-c-visaNumber') as HTMLInputElement).value).toBe('V998877');
    expect((screen.getByTestId('form-c-visaType') as HTMLInputElement).value).toBe('Tourist');
    // The older passport is not read: only the newest PASSPORT and VISA.
    expect(readGuestDocument).toHaveBeenCalledTimes(2);

    expect((screen.getByTestId('form-c-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('form-c-surname'), { target: { value: 'Mokoena' } });
    fireEvent.change(screen.getByTestId('form-c-gender'), { target: { value: 'F' } });
    await waitFor(() => expect((screen.getByTestId('form-c-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('form-c-save'));
    await waitFor(() => expect(saveFormCPerson).toHaveBeenCalledTimes(1));
    const [propertyId, reservationId, input] = saveFormCPerson.mock.calls[0] as [string, string, { recordId: string; kind: string; fields: Record<string, unknown> }];
    expect(propertyId).toBe('prop_demo');
    expect(reservationId).toBe('res_1');
    expect(input.recordId).toBe('fcb_res_1');
    expect(input.kind).toBe('BOOKED_GUEST');
    expect(input.fields).toMatchObject({ surname: 'Mokoena', gender: 'F', passportNumber: 'ZZ1234567', visaType: 'Tourist' });
    await waitFor(() => {
      const keys = invalidatedKeys(invalidateSpy);
      expect(keys).toContain(JSON.stringify(['reservation-form-c', 'prop_demo', 'res_1']));
      expect(keys).toContain(JSON.stringify(['form-c-register', 'prop_demo']));
    });
    await waitFor(() => expect(screen.getByText('Form C details saved.')).toBeTruthy());
  });

  it('adds an additional foreign national with a new id and no prefill', async () => {
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-add')).toBeTruthy());
    fireEvent.click(screen.getByTestId('form-c-add'));
    await waitFor(() => expect(screen.getByTestId('form-c-details-dialog')).toBeTruthy());
    expect(listGuestDocuments).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('form-c-surname'), { target: { value: 'Ndlovu' } });
    fireEvent.change(screen.getByTestId('form-c-gender'), { target: { value: 'M' } });
    fireEvent.change(screen.getByTestId('form-c-dateOfBirth'), { target: { value: '1985-02-03' } });
    fireEvent.change(screen.getByTestId('form-c-nationality'), { target: { value: 'ZA' } });
    fireEvent.change(screen.getByTestId('form-c-passportNumber'), { target: { value: 'AB12' } });
    fireEvent.click(screen.getByTestId('form-c-save'));
    await waitFor(() => expect(saveFormCPerson).toHaveBeenCalledTimes(1));
    const input = saveFormCPerson.mock.calls[0]![2] as { recordId: string; kind: string };
    expect(input.kind).toBe('ADDITIONAL');
    expect(input.recordId).toMatch(/^fca_[0-9a-f]{32}$/);
  });

  it('shows the server message when a save is refused', async () => {
    saveFormCPerson.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'form_c_not_foreign' },
        retryAfterMs: null,
      }),
    );
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-add')).toBeTruthy());
    fireEvent.click(screen.getByTestId('form-c-add'));
    await waitFor(() => expect(screen.getByTestId('form-c-surname')).toBeTruthy());
    fireEvent.change(screen.getByTestId('form-c-surname'), { target: { value: 'Rao' } });
    fireEvent.change(screen.getByTestId('form-c-gender'), { target: { value: 'F' } });
    fireEvent.change(screen.getByTestId('form-c-dateOfBirth'), { target: { value: '1985-02-03' } });
    fireEvent.change(screen.getByTestId('form-c-nationality'), { target: { value: 'IN' } });
    fireEvent.change(screen.getByTestId('form-c-passportNumber'), { target: { value: 'P1' } });
    fireEvent.click(screen.getByTestId('form-c-save'));
    await waitFor(() =>
      expect(screen.getByTestId('form-c-save-error').textContent).toBe(
        'Form C is for foreign nationals. An Indian national does not need one.',
      ),
    );
  });

  it('opens the audited read to edit saved details and fills the form from it', async () => {
    getReservationFormC.mockResolvedValue({
      ok: true,
      rows: [row({ detailsSaved: true, displayName: 'Zanele Mokoena', nationality: 'ZA' })],
    });
    getFormCPerson.mockResolvedValue({
      ok: true,
      recordId: 'fcb_res_1',
      reservationId: 'res_1',
      kind: 'BOOKED_GUEST',
      status: 'TO_FILE',
      deadlineAt: Date.now() + DAY,
      checkedInAt: Date.now(),
      filedReference: null,
      filedAt: null,
      fields: {
        surname: 'Mokoena',
        givenNames: 'Zanele',
        gender: 'F',
        dateOfBirth: '1990-04-01',
        nationality: 'ZA',
        passportNumber: 'ZZ9988776',
      },
    });
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-edit-fcb_res_1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('form-c-edit-fcb_res_1'));
    await waitFor(() =>
      expect((screen.getByTestId('form-c-surname') as HTMLInputElement).value).toBe('Mokoena'),
    );
    expect(getFormCPerson).toHaveBeenCalledWith('prop_demo', 'fcb_res_1');
    // Saved details are not prefilled from documents.
    expect(listGuestDocuments).not.toHaveBeenCalled();
  });

  it('views a record for filing from the audited read, with a print button and no record id', async () => {
    getReservationFormC.mockResolvedValue({
      ok: true,
      rows: [row({ detailsSaved: true, displayName: 'Zanele Mokoena', nationality: 'ZA' })],
    });
    getFormCPerson.mockResolvedValue({
      ok: true,
      recordId: 'fcb_res_1',
      reservationId: 'res_1',
      kind: 'BOOKED_GUEST',
      status: 'TO_FILE',
      deadlineAt: Date.UTC(2026, 10, 23, 10),
      checkedInAt: Date.UTC(2026, 10, 22, 10),
      filedReference: null,
      filedAt: null,
      fields: {
        surname: 'Mokoena',
        givenNames: 'Zanele',
        gender: 'F',
        dateOfBirth: '1990-04-01',
        nationality: 'ZA',
        passportNumber: 'ZZ9988776',
        portOfArrival: 'Delhi',
      },
    });
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-view-fcb_res_1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('form-c-view-fcb_res_1'));
    await waitFor(() => expect(screen.getByTestId('form-c-card')).toBeTruthy());
    const card = screen.getByTestId('form-c-card');
    expect(card.className).toContain('form-c-card');
    expect(card.className).toContain('print-doc');
    expect(within(card).getByText('ZZ9988776')).toBeTruthy();
    expect(within(card).getByText('Delhi')).toBeTruthy();
    expect(within(card).getByText('Harbor Inn')).toBeTruthy();
    expect(card.textContent).not.toContain('fcb_res_1');
    expect(card.textContent).not.toContain('res_1');
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    fireEvent.click(screen.getByTestId('form-c-print'));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('Mark filed asks for the portal reference and refreshes the stay and the register', async () => {
    getReservationFormC.mockResolvedValue({
      ok: true,
      rows: [row({ detailsSaved: true, displayName: 'Zanele Mokoena', nationality: 'ZA' })],
    });
    const { invalidateSpy } = renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-filed-fcb_res_1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('form-c-filed-fcb_res_1'));
    const confirmButton = await screen.findByTestId('form-c-filed-confirm');
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('form-c-reference'), { target: { value: '-bad!' } });
    expect((screen.getByTestId('form-c-filed-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('form-c-reference'), { target: { value: 'FC/2026-11 0042' } });
    expect((screen.getByTestId('form-c-filed-confirm') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('form-c-filed-confirm'));
    await waitFor(() => expect(markFormCFiled).toHaveBeenCalledTimes(1));
    expect(markFormCFiled.mock.calls[0]!.slice(0, 3)).toEqual(['prop_demo', 'fcb_res_1', 'FC/2026-11 0042']);
    await waitFor(() => {
      const keys = invalidatedKeys(invalidateSpy);
      expect(keys).toContain(JSON.stringify(['reservation-form-c', 'prop_demo', 'res_1']));
      expect(keys).toContain(JSON.stringify(['form-c-register', 'prop_demo']));
    });
    await waitFor(() => expect(screen.getByText('Form C marked as filed.')).toBeTruthy());
  });

  it('Mark filed is offered only once details are saved', async () => {
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-panel-table')).toBeTruthy());
    expect(screen.queryByTestId('form-c-filed-fcb_res_1')).toBeNull();
    expect(screen.queryByTestId('form-c-view-fcb_res_1')).toBeNull();
  });

  it('Remove is destructive, needs a reason, and refreshes the stay and the register', async () => {
    const { invalidateSpy } = renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-remove-fcb_res_1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('form-c-remove-fcb_res_1'));
    const confirmButton = (await screen.findByTestId('form-c-remove-confirm')) as HTMLButtonElement;
    expect(confirmButton.className).toContain('destructive');
    expect(confirmButton.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('form-c-remove-reason'), { target: { value: '   ' } });
    expect((screen.getByTestId('form-c-remove-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('form-c-remove-reason'), { target: { value: 'Left before arrival' } });
    fireEvent.click(screen.getByTestId('form-c-remove-confirm'));
    await waitFor(() => expect(removeFormCPerson).toHaveBeenCalledTimes(1));
    expect(removeFormCPerson.mock.calls[0]!.slice(0, 3)).toEqual(['prop_demo', 'fcb_res_1', 'Left before arrival']);
    await waitFor(() => {
      const keys = invalidatedKeys(invalidateSpy);
      expect(keys).toContain(JSON.stringify(['reservation-form-c', 'prop_demo', 'res_1']));
      expect(keys).toContain(JSON.stringify(['form-c-register', 'prop_demo']));
    });
  });

  it('shows the filed-already message when removal is refused', async () => {
    removeFormCPerson.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'form_c_already_filed' },
        retryAfterMs: null,
      }),
    );
    renderWith(panel());
    await waitFor(() => expect(screen.getByTestId('form-c-remove-fcb_res_1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('form-c-remove-fcb_res_1'));
    fireEvent.change(await screen.findByTestId('form-c-remove-reason'), { target: { value: 'oops' } });
    fireEvent.click(screen.getByTestId('form-c-remove-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('form-c-remove-error').textContent).toBe(
        'This Form C is already filed and cannot be changed.',
      ),
    );
  });
});

describe('Form C register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    india();
    getMe.mockResolvedValue(writeMe);
  });
  afterEach(() => cleanup());

  it('renders only for an India property', async () => {
    india(false);
    renderWith(<FormCScreen />, '/form-c');
    await waitFor(() => expect(screen.getByTestId('form-c-not-applicable')).toBeTruthy());
    expect(getFormCRegister).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Form C' })).toBeTruthy();
  });

  it('defaults to To file, lists rows with a stay link, and uses the live property name', async () => {
    getFormCRegister.mockResolvedValue({
      ok: true,
      rows: [
        row({ detailsSaved: true, displayName: 'Zanele Mokoena', nationality: 'ZA', overdue: true, deadlineAt: Date.now() - 1000 }),
        row({ recordId: 'fca_9', reservationId: 'res_9', kind: 'ADDITIONAL' }),
      ],
    });
    renderWith(<FormCScreen />, '/form-c');
    await waitFor(() => expect(screen.getByTestId('form-c-register-table')).toBeTruthy());
    expect(getFormCRegister).toHaveBeenCalledWith('prop_demo', 'to_file');
    expect(screen.getByRole('heading', { level: 1, name: 'Form C' })).toBeTruthy();
    expect(screen.getByText(/Harbor Inn/)).toBeTruthy();
    const first = screen.getByTestId('form-c-register-row-fcb_res_1');
    expect(within(first).getByText('Zanele Mokoena')).toBeTruthy();
    expect(within(first).getByText('Overdue')).toBeTruthy();
    expect(within(first).getByRole('link', { name: 'Open stay' }).getAttribute('href')).toBe('/reservations/res_1');
    expect(within(screen.getByTestId('form-c-register-row-fca_9')).getByText('Details needed')).toBeTruthy();
  });

  it('reads the filter from the link the Exceptions alert uses', async () => {
    getFormCRegister.mockResolvedValue({ ok: true, rows: [] });
    renderWith(<FormCScreen />, '/form-c?filter=overdue');
    await waitFor(() => expect(getFormCRegister).toHaveBeenCalledWith('prop_demo', 'overdue'));
    expect((screen.getByTestId('form-c-filter') as HTMLSelectElement).value).toBe('overdue');
  });

  it('keeps empty, error and no-match as three different states', async () => {
    getFormCRegister.mockResolvedValue({ ok: true, rows: [] });
    renderWith(<FormCScreen />, '/form-c?filter=filed');
    await waitFor(() => expect(screen.getByTestId('form-c-register-nomatch')).toBeTruthy());
    expect(screen.getByText('No records match this filter.')).toBeTruthy();
    cleanup();

    renderWith(<FormCScreen />, '/form-c?filter=all');
    await waitFor(() => expect(screen.getByTestId('form-c-register-empty')).toBeTruthy());
    expect(screen.getByText('No Form C records yet.')).toBeTruthy();
    cleanup();

    getFormCRegister.mockRejectedValue(
      new ClassifiedError({ class: 'fail_closed', status: 503, body: {}, retryAfterMs: null }),
    );
    renderWith(<FormCScreen />, '/form-c');
    await waitFor(() => expect(screen.getByTestId('form-c-register-error')).toBeTruthy());
    expect(screen.queryByTestId('form-c-register-empty')).toBeNull();
    expect(screen.queryByTestId('form-c-register-nomatch')).toBeNull();
  });

  it('changing the filter asks for that filter', async () => {
    getFormCRegister.mockResolvedValue({ ok: true, rows: [row()] });
    renderWith(<FormCScreen />, '/form-c');
    await waitFor(() => expect(screen.getByTestId('form-c-register-table')).toBeTruthy());
    fireEvent.change(screen.getByTestId('form-c-filter'), { target: { value: 'filed' } });
    await waitFor(() => expect(getFormCRegister).toHaveBeenCalledWith('prop_demo', 'filed'));
  });
});

describe('Form C overdue alert on the Exceptions screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    india();
  });
  afterEach(() => cleanup());

  it('shows the count with a link to the overdue register', async () => {
    getFormCRegister.mockResolvedValue({ ok: true, rows: [row(), row({ recordId: 'fca_2' })] });
    renderWith(<FormCOverdueAlert />);
    await waitFor(() => expect(screen.getByTestId('form-c-overdue-alert')).toBeTruthy());
    expect(getFormCRegister).toHaveBeenCalledWith('prop_demo', 'overdue');
    const alert = screen.getByTestId('form-c-overdue-alert');
    expect(alert.textContent).toContain('2 Form C records are past their 24-hour deadline.');
    expect(within(alert).getByRole('link').getAttribute('href')).toBe('/form-c?filter=overdue');
  });

  it('shows nothing at zero, outside India, or when the read fails', async () => {
    getFormCRegister.mockResolvedValue({ ok: true, rows: [] });
    renderWith(<FormCOverdueAlert />);
    await waitFor(() => expect(getFormCRegister).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('form-c-overdue-alert')).toBeNull();
    cleanup();

    india(false);
    getFormCRegister.mockClear();
    renderWith(<FormCOverdueAlert />);
    await waitFor(() => expect(getProperty).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(getFormCRegister).not.toHaveBeenCalled();
    expect(screen.queryByTestId('form-c-overdue-alert')).toBeNull();
    cleanup();

    india();
    getFormCRegister.mockRejectedValue(
      new ClassifiedError({ class: 'forbidden', status: 403, body: {}, retryAfterMs: null }),
    );
    renderWith(<FormCOverdueAlert />);
    await waitFor(() => expect(getFormCRegister).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('form-c-overdue-alert')).toBeNull();
  });
});
