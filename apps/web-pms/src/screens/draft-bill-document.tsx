import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Badge,
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
  PageHeader,
  SectionLabel,
  Skeleton,
  StatField,
  reservationStatusWord,
} from '@hospai/ui-kit';
import { meShellStateFromQuery } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { resolveDocumentPrintGate } from './document-print-views.js';
import { folioWindowLabel } from './folio-window-label.js';
import { PrintDocumentControl } from './registration-card.js';

export type DraftBillChargeReview = {
  folioWindowId: string;
  windowKind?: string;
  billedParty?: string | null;
  chargeCode: string;
  label: string;
  lineCount: number;
  baseMinor: number;
  taxMinor: number;
  totalMinor: number;
};

export type DraftBillTariffRow = {
  stayDate: string;
  state: 'posted' | 'unposted' | 'future' | string;
  expectedRoomMinor: number;
  postedRoomNetMinor: number;
  mismatch: boolean;
};

export type DraftBillData = {
  ok: true;
  reservationId: string;
  status: string;
  currency: string;
  confirmationToken?: string;
  arrivalDate?: string;
  departureDate?: string;
  nights?: number;
  adults?: number;
  children?: number;
  roomTypeName?: string | null;
  roomCode?: string | null;
  ratePlanName?: string | null;
  packageName?: string | null;
  guestDisplayName?: string | null;
  chargeReview: DraftBillChargeReview[];
  tariffCheck: DraftBillTariffRow[];
  totals: {
    postedChargesMinor: number;
    futureEstimateMinor: number;
    advancePaidMinor: number;
    balanceNowMinor: number;
    projectedBalanceMinor: number;
  };
  invoice: { invoiceNumber: string; generatedAt: number } | null;
};

/** Operator words for tariff check state — never print the raw enum. */
export function draftBillTariffStateWord(state: string): string {
  switch (state) {
    case 'posted':
      return 'Posted';
    case 'unposted':
      return 'Unposted';
    case 'future':
      return 'Future';
    default:
      return 'Unknown';
  }
}

function partyText(adults: number, children: number): string {
  const a = `${adults} ${adults === 1 ? 'adult' : 'adults'}`;
  if (children === 0) return a;
  return `${a} · ${children} ${children === 1 ? 'child' : 'children'}`;
}

function isOkDraftBill(body: unknown): body is DraftBillData {
  return Boolean(body && typeof body === 'object' && (body as { ok?: unknown }).ok === true);
}

/**
 * Draft bill from a successful `get_reservation_draft_bill` response (R4.29).
 * Print banner: "Draft — not a tax invoice". Words for tariff states; mismatch Badge always shows a word.
 */
export function DraftBillDocument({
  propertyName,
  data,
}: {
  propertyName: string | null;
  data: DraftBillData;
}) {
  const { money, date } = useFormat();
  const chargeWindows: Array<{
    folioWindowId: string;
    windowKind?: string;
    billedParty?: string | null;
    rows: DraftBillChargeReview[];
  }> = [];
  for (const row of data.chargeReview) {
    let g = chargeWindows.find((x) => x.folioWindowId === row.folioWindowId);
    if (!g) {
      g = {
        folioWindowId: row.folioWindowId,
        windowKind: row.windowKind,
        billedParty: row.billedParty,
        rows: [],
      };
      chargeWindows.push(g);
    }
    g.rows.push(row);
  }

  return (
    <div data-testid="draft-bill-doc" className="print-doc draft-bill-doc">
      <div className="draft-bill-doc__head">
        <SectionLabel>Draft bill</SectionLabel>
        {propertyName ? <p className="draft-bill-doc__property">{propertyName}</p> : null}
      </div>
      <p className="draft-bill-doc__banner" data-testid="draft-bill-print-banner">
        Draft — not a tax invoice
      </p>
      <div className="ui-stat-grid" data-testid="draft-bill-stay-header">
        <StatField label="Guest" value={data.guestDisplayName ?? '—'} />
        <StatField label="Confirmation" value={data.confirmationToken ?? '—'} />
        <StatField
          label="Arrival"
          value={data.arrivalDate ? date(data.arrivalDate) : '—'}
        />
        <StatField
          label="Departure"
          value={data.departureDate ? date(data.departureDate) : '—'}
        />
        <StatField label="Nights" value={data.nights ?? '—'} />
        <StatField
          label="Guests"
          value={
            data.adults != null && data.children != null
              ? partyText(data.adults, data.children)
              : '—'
          }
        />
        <StatField label="Room type" value={data.roomTypeName || '—'} />
        <StatField label="Room" value={data.roomCode || 'Not assigned'} />
        {data.ratePlanName ? <StatField label="Rate plan" value={data.ratePlanName} /> : null}
        {data.packageName ? <StatField label="Package" value={data.packageName} /> : null}
        <StatField label="Status" value={reservationStatusWord(data.status)} />
        <StatField
          label="Invoice"
          value={data.invoice ? data.invoice.invoiceNumber : 'None'}
        />
      </div>

      <div className="draft-bill-doc__section" data-testid="draft-bill-charge-review">
        <SectionLabel>Charge review</SectionLabel>
        {chargeWindows.map((group) => (
          <div key={group.folioWindowId} data-testid="draft-bill-window-group">
            <h3 className="draft-bill-doc__window">
              {folioWindowLabel({ kind: group.windowKind ?? 'GUEST', billedParty: group.billedParty })}
            </h3>
            <div className="ui-table-scroll">
              <DataTable>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Charge</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Lines</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Base</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Tax</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Total</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {group.rows.map((row) => (
                    <DataTableRow key={`${row.folioWindowId}-${row.chargeCode}`}>
                      <DataTableCell>{row.label?.trim() ? row.label : row.chargeCode}</DataTableCell>
                      <DataTableCell align="right">
                        <span className="ui-num">{row.lineCount}</span>
                      </DataTableCell>
                      <DataTableCell align="right">
                        <span className="ui-num">{money(row.baseMinor)}</span>
                      </DataTableCell>
                      <DataTableCell align="right">
                        <span className="ui-num">{money(row.taxMinor)}</span>
                      </DataTableCell>
                      <DataTableCell align="right">
                        <span className="ui-num">{money(row.totalMinor)}</span>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </div>
          </div>
        ))}
      </div>

      <div className="draft-bill-doc__section" data-testid="draft-bill-tariff-check">
        <SectionLabel>Tariff check</SectionLabel>
        <div className="ui-table-scroll">
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Date</DataTableHeaderCell>
                <DataTableHeaderCell>State</DataTableHeaderCell>
                <DataTableHeaderCell align="right">Expected</DataTableHeaderCell>
                <DataTableHeaderCell align="right">Posted</DataTableHeaderCell>
                <DataTableHeaderCell>Check</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {data.tariffCheck.map((row) => (
                <DataTableRow key={row.stayDate}>
                  <DataTableCell>
                    <span className="ui-num">{date(row.stayDate)}</span>
                  </DataTableCell>
                  <DataTableCell>{draftBillTariffStateWord(row.state)}</DataTableCell>
                  <DataTableCell align="right">
                    <span className="ui-num">{money(row.expectedRoomMinor)}</span>
                  </DataTableCell>
                  <DataTableCell align="right">
                    <span className="ui-num">{money(row.postedRoomNetMinor)}</span>
                  </DataTableCell>
                  <DataTableCell>
                    {row.mismatch ? (
                      <Badge rung="exception" data-testid={`tariff-mismatch-${row.stayDate}`}>
                        Mismatch
                      </Badge>
                    ) : row.state === 'posted' ? (
                      <span className="muted">Match</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </div>
      </div>

      <div className="ui-stat-grid" data-testid="draft-bill-totals">
        <StatField label="Posted charges" value={money(data.totals.postedChargesMinor)} />
        <StatField label="Future estimate" value={money(data.totals.futureEstimateMinor)} />
        <StatField label="Advances" value={money(data.totals.advancePaidMinor)} />
        <StatField label="Balance now" value={money(data.totals.balanceNowMinor)} />
        <StatField label="Projected balance" value={money(data.totals.projectedBalanceMinor)} />
      </div>
    </div>
  );
}

function useAuthorityLive(): boolean {
  const meQ = useQuery({
    queryKey: ['me', tenant.propertyId],
    queryFn: () => api.getMe(tenant.propertyId),
    retry: false,
  });
  const shell = meShellStateFromQuery({
    status: meQ.status,
    data: meQ.data,
    classified: meQ.error ? asClassified(meQ.error) : undefined,
  });
  return shell.kind === 'authority' && shell.authority.kind === 'live';
}

function usePropertyName(): string | null {
  const propertyQ = useQuery({
    queryKey: ['property', tenant.propertyId],
    queryFn: () => api.getProperty(tenant.propertyId),
    retry: false,
  });
  return propertyQ.data?.property?.name ?? null;
}

/** R4.13-style print view for the draft bill (R4.29). */
export function DraftBillPrintView() {
  const { reservationId = '' } = useParams();
  const propertyId = tenant.propertyId;
  const propertyName = usePropertyName();
  const authorityLive = useAuthorityLive();

  const draftQ = useQuery({
    queryKey: ['draft-bill', propertyId, reservationId],
    queryFn: () => api.getReservationDraftBill(propertyId, reservationId),
    staleTime: 0,
    enabled: Boolean(reservationId),
    retry: false,
  });

  const draftData = isOkDraftBill(draftQ.data) ? draftQ.data : null;
  const okPayload = draftData !== null;
  const gate = resolveDocumentPrintGate({
    isPending: draftQ.isPending,
    isError: draftQ.isError,
    isSuccess: draftQ.isSuccess,
    error: draftQ.error,
    okPayload,
    authorityLive,
  });

  const failClosed =
    draftQ.isError && asClassified(draftQ.error).class === 'fail_closed';

  return (
    <div className="ui-page-stack print-view" data-testid="draft-bill-print-view">
      <PageHeader
        title="Draft bill"
        subtitle={propertyName}
        back={
          <Link to={`/folio/${encodeURIComponent(reservationId)}`}>Folio</Link>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Print</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            <PrintDocumentControl canPrint={gate.canPrint} reason={gate.reason} label="Print" />
            {draftQ.isError ? (
              <Alert intent="exception" data-testid="draft-bill-error">
                {classifiedUserMessage(asClassified(draftQ.error), {
                  fallback: failClosed
                    ? 'Property unreachable — the draft bill is unavailable.'
                    : 'Could not load the draft bill.',
                })}
              </Alert>
            ) : null}
            {draftQ.isPending ? <Skeleton /> : null}
          </div>
        </CardContent>
      </Card>
      {draftData && !draftQ.isError ? (
        <DraftBillDocument propertyName={propertyName} data={draftData} />
      ) : null}
    </div>
  );
}
