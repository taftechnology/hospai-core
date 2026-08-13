export type FolioLine = {
  folioLineId: string;
  folioWindowId?: string;
  chargeCode: string;
  amountMinor: number;
  ledgerAmountMinor: number;
  txnCurrency: string;
  fxRate?: string;
  fxRateAt?: number;
  source: string | null;
  businessDate: string | null;
  splitOf: string | null;
  createdAt: number;
  paymentId: string | null;
  taxOf: string | null;
  taxRuleId: string | null;
};

export type FolioDisplayNode = {
  line: FolioLine;
  taxes: FolioDisplayNode[];
  orphanTax?: boolean;
};

export type FolioFoldResult = {
  roots: FolioDisplayNode[];
  liveTotalMinor: number;
};

function isTax(line: FolioLine): boolean {
  return line.source === 'TAX';
}

export function foldFolioLines(lines: readonly FolioLine[]): FolioFoldResult {
  const superseded = new Set<string>();
  for (const line of lines) {
    if (line.splitOf) superseded.add(line.splitOf);
  }

  const isLive = (line: FolioLine): boolean =>
    !superseded.has(line.folioLineId) && line.source !== 'SPLIT_REVERSAL';

  let liveTotalMinor = 0;
  const liveById = new Map<string, FolioLine>();
  for (const line of lines) {
    if (!isLive(line)) continue;
    liveTotalMinor += line.ledgerAmountMinor;
    liveById.set(line.folioLineId, line);
  }

  const taxesByParent = new Map<string, FolioLine[]>();
  const orphanTaxes: FolioLine[] = [];
  for (const line of lines) {
    if (!isLive(line) || !isTax(line)) continue;
    const parentId = line.taxOf;
    if (parentId && liveById.has(parentId) && !isTax(liveById.get(parentId)!)) {
      const bucket = taxesByParent.get(parentId) ?? [];
      bucket.push(line);
      taxesByParent.set(parentId, bucket);
    } else {
      orphanTaxes.push(line);
    }
  }

  const roots: FolioDisplayNode[] = [];
  const emittedTaxIds = new Set<string>();

  for (const line of lines) {
    if (!isLive(line) || isTax(line)) continue;
    const taxLines = taxesByParent.get(line.folioLineId) ?? [];
    const taxes = taxLines.map((t) => {
      emittedTaxIds.add(t.folioLineId);
      return { line: t, taxes: [] as FolioDisplayNode[] };
    });
    roots.push({ line, taxes });
  }

  for (const line of orphanTaxes) {
    if (emittedTaxIds.has(line.folioLineId)) continue;
    roots.push({ line, taxes: [], orphanTax: true });
  }

  return { roots, liveTotalMinor };
}
