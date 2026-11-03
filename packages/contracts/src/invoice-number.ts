export type InvoiceSeries = 'continuous' | 'gst_financial_year';

function pad2(n: number): string {
  const v = ((n % 100) + 100) % 100;
  return String(v).padStart(2, '0');
}

export function financialYearLabel(invoiceDate: string): string {
  const year = Number(invoiceDate.slice(0, 4));
  const month = Number(invoiceDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${pad2(start)}-${pad2(start + 1)}`;
}

export function formatInvoiceNumber(input: {
  series: InvoiceSeries;
  prefix: string;
  suffix: string;
  counter: number;
  invoiceDate: string;
}): string {
  const { series, prefix, suffix, counter, invoiceDate } = input;
  if (series === 'continuous') {
    return `${prefix}${String(counter).padStart(6, '0')}${suffix}`;
  }
  return `${prefix}${financialYearLabel(invoiceDate)}/${String(counter).padStart(5, '0')}${suffix}`;
}

const GST_CHARSET = /^[A-Za-z0-9\-/]*$/;

const LENGTH_REASON =
  'Invoice numbers in a financial-year series must be at most 16 characters.';
const CHARSET_REASON =
  'Invoice numbers in a financial-year series may use only letters, digits, hyphens, and slashes.';

export function invoiceNumberProblem(input: {
  series: InvoiceSeries;
  prefix: string;
  suffix: string;
  counter: number;
  invoiceDate: string;
}): string | null {
  if (input.series === 'continuous') {
    return null;
  }
  const formatted = formatInvoiceNumber(input);
  if (formatted.length > 16) {
    return LENGTH_REASON;
  }
  if (!GST_CHARSET.test(formatted)) {
    return CHARSET_REASON;
  }
  return null;
}
