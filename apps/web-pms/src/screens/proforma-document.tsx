import { getConfigEntry } from '@hospai/contracts';
import { reservationStatusWord, SectionLabel, StatField } from '@hospai/ui-kit';
import { useFormat } from '../shell/PropertyFormat.js';

export type ProformaShow = {
  perNight: boolean;
  taxSummary: boolean;
  advances: boolean;
  warnings: boolean;
};

export type ProformaPresentation = {
  template: 'STANDARD' | 'DETAILED';
  headerText: string;
  footerText: string;
  show: ProformaShow;
};

export type ProformaLine = {
  chargeCode: string;
  label?: string;
  amountMinor: number;
  taxMinor: number;
  source: string;
};

export type ProformaData = {
  ok: true;
  status: string;
  currency: string;
  presentation?: unknown;
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
  posted: Array<{ businessDate: string; lines: ProformaLine[] }>;
  estimated: Array<{ stayDate: string; lines: ProformaLine[] }>;
  totals: {
    baseMinor: number;
    taxMinor: number;
    estimatedTotalMinor: number;
    advancePaidMinor: number;
    balanceMinor: number;
  };
  taxSummary: Array<{ outputChargeCode: string; label?: string; amountMinor: number }>;
  warnings: Array<{ stayDate?: string; code: string }>;
};

function defaultProformaPresentation(): ProformaPresentation {
  const d = getConfigEntry('pms.documents.proforma')?.default as ProformaPresentation;
  return {
    template: d?.template === 'DETAILED' ? 'DETAILED' : 'STANDARD',
    headerText: typeof d?.headerText === 'string' ? d.headerText : '',
    footerText: typeof d?.footerText === 'string' ? d.footerText : '',
    show: {
      perNight: d?.show?.perNight !== false,
      taxSummary: d?.show?.taxSummary !== false,
      advances: d?.show?.advances !== false,
      warnings: d?.show?.warnings !== false,
    },
  };
}

export function asProformaPresentation(value: unknown): ProformaPresentation {
  const d = defaultProformaPresentation();
  if (!value || typeof value !== 'object') return d;
  const v = value as Partial<ProformaPresentation>;
  const show = (v.show ?? {}) as Partial<ProformaShow>;
  return {
    template: v.template === 'DETAILED' ? 'DETAILED' : 'STANDARD',
    headerText: typeof v.headerText === 'string' ? v.headerText : d.headerText,
    footerText: typeof v.footerText === 'string' ? v.footerText : d.footerText,
    show: {
      perNight: show.perNight ?? d.show.perNight,
      taxSummary: show.taxSummary ?? d.show.taxSummary,
      advances: show.advances ?? d.show.advances,
      warnings: show.warnings ?? d.show.warnings,
    },
  };
}

/** Operator words for folio line `source` — never print the raw enum. */
export function proformaSourceLabel(source: string): string {
  switch (source) {
    case 'NIGHT_AUDIT':
      return 'Room night';
    case 'INCLUSION':
      return 'Included';
    case 'RECURRING':
      return 'Scheduled add-on';
    default:
      return 'Charge';
  }
}

function lineLabel(line: ProformaLine): string {
  return line.label?.trim() ? line.label : line.chargeCode;
}

function partyText(adults: number, children: number): string {
  const a = `${adults} ${adults === 1 ? 'adult' : 'adults'}`;
  if (children === 0) return a;
  return `${a} · ${children} ${children === 1 ? 'child' : 'children'}`;
}

function NightBlock({
  title,
  dateLabel,
  lines,
  money,
  detailed,
}: {
  title: string;
  dateLabel: string;
  lines: ProformaLine[];
  money: (n: number) => string;
  detailed: boolean;
}) {
  return (
    <div className="proforma-doc__night">
      <p className="proforma-doc__night-title">
        {title} · {dateLabel}
      </p>
      <ul className="proforma-doc__lines">
        {lines.map((line, i) => (
          <li key={`${line.chargeCode}-${i}`}>
            <span>{lineLabel(line)}</span>
            {detailed ? <span className="muted">{proformaSourceLabel(line.source)}</span> : null}
            <span className="ui-num">{money(line.amountMinor)}</span>
            {line.taxMinor !== 0 ? (
              <span className="muted">tax {money(line.taxMinor)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Proforma from a successful `get_reservation_proforma` response (R4.13 B4).
 * Never renders reservation UUID — totals, labels, and stay header only.
 */
export function ProformaDocument({
  propertyName,
  data,
  templateOverride,
}: {
  propertyName: string | null;
  data: ProformaData;
  templateOverride?: 'STANDARD' | 'DETAILED';
}) {
  const { money, date } = useFormat();
  const presentation = asProformaPresentation(data.presentation);
  const template = templateOverride ?? presentation.template;
  const detailed = template === 'DETAILED';
  const show = presentation.show;
  const hasStayHeader =
    data.confirmationToken != null ||
    data.arrivalDate != null ||
    data.departureDate != null ||
    data.guestDisplayName !== undefined;

  return (
    <div
      data-testid="proforma-doc"
      data-template={template}
      className={
        detailed
          ? 'print-doc proforma-doc proforma-doc--detailed'
          : 'print-doc proforma-doc proforma-doc--standard'
      }
    >
      <div className="proforma-doc__head">
        <SectionLabel>Proforma</SectionLabel>
        {propertyName ? <p className="proforma-doc__property">{propertyName}</p> : null}
      </div>
      {presentation.headerText ? (
        <p className="proforma-doc__header-text" data-testid="proforma-header">
          {presentation.headerText}
        </p>
      ) : null}
      {hasStayHeader ? (
        <div className="ui-stat-grid" data-testid="proforma-stay-header">
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
        </div>
      ) : null}
      <div className="ui-stat-grid">
        <StatField label="Status" value={reservationStatusWord(data.status)} />
        <StatField label="Base" value={money(data.totals.baseMinor)} />
        <StatField label="Tax" value={money(data.totals.taxMinor)} />
        <StatField label="Estimated total" value={money(data.totals.estimatedTotalMinor)} />
        {show.advances ? (
          <>
            <StatField label="Advances" value={money(data.totals.advancePaidMinor)} />
            <StatField label="Balance" value={money(data.totals.balanceMinor)} />
          </>
        ) : null}
      </div>
      {show.perNight ? (
        <div className="proforma-doc__nights" data-testid="proforma-nights">
          {data.posted.map((night) => (
            <NightBlock
              key={`posted-${night.businessDate}`}
              title="Posted"
              dateLabel={date(night.businessDate)}
              lines={night.lines}
              money={money}
              detailed={detailed}
            />
          ))}
          {data.estimated.map((night) => (
            <NightBlock
              key={`est-${night.stayDate}`}
              title="Estimated"
              dateLabel={date(night.stayDate)}
              lines={night.lines}
              money={money}
              detailed={detailed}
            />
          ))}
        </div>
      ) : null}
      {show.taxSummary && data.taxSummary.length > 0 ? (
        <div className="proforma-doc__tax" data-testid="proforma-tax-summary">
          <SectionLabel>Tax summary</SectionLabel>
          <ul className="proforma-doc__lines">
            {data.taxSummary.map((row) => (
              <li key={row.outputChargeCode}>
                <span>{row.label?.trim() ? row.label : row.outputChargeCode}</span>
                <span className="ui-num">{money(row.amountMinor)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {show.warnings && data.warnings.length > 0 ? (
        <div className="proforma-doc__warnings" data-testid="proforma-warnings">
          <SectionLabel>Warnings</SectionLabel>
          <ul>
            {data.warnings.map((w, i) => (
              <li key={`${w.code}-${w.stayDate ?? i}`}>
                {w.stayDate ? `${date(w.stayDate)} · ` : ''}
                {w.code}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {presentation.footerText ? (
        <p className="proforma-doc__footer-text" data-testid="proforma-footer">
          {presentation.footerText}
        </p>
      ) : null}
    </div>
  );
}
