import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  FieldGroup,
  Input,
  NativeSelect,
  RowActions,
  Skeleton,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { isQueuedResult, queuedWriteCopy } from '../copy/is-queued-result.js';
import { useFormat } from '../shell/PropertyFormat.js';
import {
  currencyMinorExponent,
  fractionToPercent,
  majorToMinor,
  minorToMajor,
  percentToFraction,
  ruleKeyFromName,
} from './settings-tax-format.js';
import { productsQueryKey } from './settings-products.js';
import { SYSTEM_CHARGE_CODES } from './system-charge-codes.js';

const MAX_BANDS = 10;
const MAX_PARTS = 4;
const POSTED_NOTE =
  'Charges already posted keep their tax. A change applies to charges posted on or after its start date.';
const PRESET_HINT = 'Fills the structure. Enter the rates and limits your tax advisor confirms.';

type PartDraft = { code: string; percent: string };
type BandDraft = { upTo: string; parts: PartDraft[] };
type PriceMode = 'EXCLUSIVE' | 'INCLUSIVE';
type TaxBase = 'NET' | 'NET_PLUS_PRIOR';
type Draft = {
  name: string;
  taxGroup: string;
  validFrom: string;
  priceMode: PriceMode;
  sequence: string;
  base: TaxBase;
  conditionKey: string;
  conditionValue: string;
  rebands: 'yes' | 'no';
  bands: BandDraft[];
};
type EditorMode = { kind: 'create' } | { kind: 'change'; ruleKey: string; name: string };
type PartError = { code?: string; percent?: string };
type DraftErrors = {
  name?: string;
  taxGroup?: string;
  validFrom?: string;
  sequence?: string;
  base?: string;
  conditionValue?: string;
  parts: Record<string, PartError>;
  limits: Record<string, string>;
};
type TaxComponent = { outputChargeCode: string; rate: string };
type TaxBandWrite = { upToMinor: number | null; components: TaxComponent[] };
type TaxWrite = {
  name: string;
  ruleType: 'PERCENTAGE';
  taxGroup: string;
  validFrom: string;
  priceMode: PriceMode;
  sequence: number;
  base: TaxBase;
  conditionKey: string | null;
  conditionValue: string | null;
  rebandsOnDiscount: boolean;
  bands: TaxBandWrite[];
  rate: string;
  outputChargeCode: string;
};
type LoadedComponent = { outputChargeCode?: string; rate?: string };
type LoadedBand = { upToMinor?: number | null; components?: LoadedComponent[] };
type TaxRuleRow = {
  taxRuleId: string;
  ruleKey: string;
  name: string;
  ruleType?: string;
  rate?: string;
  taxGroup: string;
  outputChargeCode?: string;
  validFrom: string;
  validTo: string | null;
  priceMode?: string;
  sequence?: number;
  base?: string;
  conditionKey?: string | null;
  conditionValue?: string | null;
  rebandsOnDiscount?: boolean;
  bands?: LoadedBand[];
};
type DeclarationRow = {
  declarationId: string;
  declarationKey: string;
  value: string;
  validFrom: string;
  validTo: string | null;
};
type ChargeCodeRow = { code: string; name: string; status: string; taxGroup: string | null };
type Registration = { label: string; number: string };
type LocationValue = { country: string; region: string; locality: string };
type LocationSave = {
  country: string;
  region: string | null;
  locality: string | null;
  registrations: Registration[];
  reason: string;
};
type Notice = { intent: 'settled' | 'attention' | 'exception'; text: string };

const EMPTY_ERRORS: DraftErrors = { parts: {}, limits: {} };

function blankPart(): PartDraft {
  return { code: '', percent: '' };
}

function blankDraft(): Draft {
  return {
    name: '',
    taxGroup: '',
    validFrom: '',
    priceMode: 'EXCLUSIVE',
    sequence: '0',
    base: 'NET',
    conditionKey: '',
    conditionValue: '',
    rebands: 'yes',
    bands: [{ upTo: '', parts: [blankPart()] }],
  };
}

function gstBand(): BandDraft {
  return {
    upTo: '',
    parts: [
      { code: 'CGST', percent: '' },
      { code: 'SGST', percent: '' },
    ],
  };
}

function partKey(band: number, part: number): string {
  return `${band}:${part}`;
}

function hasDraftErrors(errors: DraftErrors): boolean {
  if (errors.name || errors.taxGroup || errors.validFrom || errors.sequence || errors.base || errors.conditionValue) {
    return true;
  }
  if (Object.keys(errors.limits).length > 0) return true;
  return Object.values(errors.parts).some((part) => part.code || part.percent);
}

function validateDraft(draft: Draft, exponent: number): { errors: DraftErrors; write: TaxWrite | null } {
  const errors: DraftErrors = { parts: {}, limits: {} };
  const name = draft.name.trim();
  const taxGroup = draft.taxGroup.trim();
  if (!name) errors.name = 'Enter a name.';
  if (!taxGroup) errors.taxGroup = 'Enter a product group.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.validFrom)) errors.validFrom = 'Choose the date this starts.';
  if (!/^\d+$/.test(draft.sequence.trim())) errors.sequence = 'Enter a whole number, 0 or higher.';
  if (draft.priceMode === 'INCLUSIVE' && draft.base === 'NET_PLUS_PRIOR') {
    errors.base = 'Included in the price is calculated on the price only.';
  }
  const conditionKey = draft.conditionKey.trim();
  const conditionValue = draft.conditionValue.trim();
  if (conditionKey && !conditionValue) errors.conditionValue = 'Enter a value.';

  const bandWrites: TaxBandWrite[] = [];
  let previous = 0;
  draft.bands.forEach((band, bandIndex) => {
    const last = bandIndex === draft.bands.length - 1;
    let upToMinor: number | null = null;
    if (!last) {
      const minor = majorToMinor(band.upTo, exponent);
      if (minor == null) errors.limits[String(bandIndex)] = 'Enter an amount, such as 7500.';
      else if (minor <= previous) errors.limits[String(bandIndex)] = 'Enter an amount above the band before.';
      else {
        previous = minor;
        upToMinor = minor;
      }
    }
    const components: TaxComponent[] = [];
    band.parts.forEach((part, partIndex) => {
      const code = part.code.trim();
      const rate = percentToFraction(part.percent);
      const partError: PartError = {};
      if (!code) partError.code = 'Choose a tax line code.';
      if (rate == null) partError.percent = 'Enter a percent, such as 2.5.';
      if (partError.code || partError.percent || rate == null) {
        errors.parts[partKey(bandIndex, partIndex)] = partError;
      } else {
        components.push({ outputChargeCode: code, rate });
      }
    });
    bandWrites.push({ upToMinor, components });
  });

  const first = bandWrites[0]?.components[0];
  if (hasDraftErrors(errors) || !first || !name || !taxGroup) return { errors, write: null };
  return {
    errors,
    write: {
      name,
      ruleType: 'PERCENTAGE',
      taxGroup,
      validFrom: draft.validFrom,
      priceMode: draft.priceMode,
      sequence: Number(draft.sequence.trim()),
      base: draft.base,
      conditionKey: conditionKey || null,
      conditionValue: conditionKey ? conditionValue : null,
      rebandsOnDiscount: draft.rebands === 'yes',
      bands: bandWrites,
      rate: first.rate,
      outputChargeCode: first.outputChargeCode,
    },
  };
}

function effectiveBands(rule: TaxRuleRow): LoadedBand[] {
  if (rule.bands && rule.bands.length > 0) return rule.bands;
  return [{ upToMinor: null, components: [{ outputChargeCode: rule.outputChargeCode, rate: rule.rate }] }];
}

function draftFromRule(rule: TaxRuleRow, exponent: number): Draft {
  const bands = effectiveBands(rule);
  return {
    name: rule.name,
    taxGroup: rule.taxGroup,
    validFrom: '',
    priceMode: rule.priceMode === 'INCLUSIVE' ? 'INCLUSIVE' : 'EXCLUSIVE',
    sequence: rule.sequence == null ? '0' : String(rule.sequence),
    base: rule.base === 'NET_PLUS_PRIOR' ? 'NET_PLUS_PRIOR' : 'NET',
    conditionKey: rule.conditionKey ?? '',
    conditionValue: rule.conditionValue ?? '',
    rebands: rule.rebandsOnDiscount === false ? 'no' : 'yes',
    bands: bands.map((band, index) => ({
      upTo:
        index === bands.length - 1 || band.upToMinor == null ? '' : minorToMajor(band.upToMinor, exponent),
      parts: (band.components ?? []).map((component) => ({
        code: component.outputChargeCode ?? '',
        percent: fractionToPercent(component.rate ?? ''),
      })),
    })),
  };
}

function priceLabel(mode: string | undefined): string {
  return mode === 'INCLUSIVE' ? 'Included in the price' : 'Added on top';
}

function rateLines(rule: TaxRuleRow, money: (minor: number) => string): string[] {
  const bands = effectiveBands(rule);
  return bands.map((band, index) => {
    const parts = (band.components ?? [])
      .map((component) => `${component.outputChargeCode ?? ''} ${fractionToPercent(component.rate ?? '')}%`.trim())
      .join(' + ');
    if (bands.length === 1) return `All amounts: ${parts}`;
    if (index === bands.length - 1) {
      const prev = bands[index - 1]?.upToMinor;
      return prev == null ? `and above: ${parts}` : `Above ${money(prev)}: ${parts}`;
    }
    if (band.upToMinor == null) return `and above: ${parts}`;
    return `Up to ${money(band.upToMinor)}: ${parts}`;
  });
}

function partFieldLabel(
  bandCount: number,
  bandIndex: number,
  partCount: number,
  partIndex: number,
  kind: 'code' | 'rate',
): string {
  const noun = kind === 'rate' ? 'rate (%)' : 'tax line code';
  if (bandCount === 1 && partCount === 1) return kind === 'rate' ? 'Rate (%)' : 'Tax line code';
  if (bandCount === 1) return `Part ${partIndex + 1} ${noun}`;
  if (partCount === 1) return `Band ${bandIndex + 1} ${noun}`;
  return `Band ${bandIndex + 1} part ${partIndex + 1} ${noun}`;
}

function limitFieldLabel(currency: string | null, bandIndex: number, limitCount: number): string {
  const base = currency ? `Up to (per night, ${currency})` : 'Up to (per night)';
  if (limitCount <= 1) return base;
  return `Band ${bandIndex + 1} ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}

function bandHeading(
  bands: BandDraft[],
  index: number,
  money: (minor: number) => string,
  exponent: number,
): string {
  if (bands.length === 1) return 'All amounts';
  const last = index === bands.length - 1;
  if (last) {
    const previous = index > 0 ? majorToMinor(bands[index - 1]!.upTo, exponent) : null;
    if (previous == null) return `Band ${index + 1}`;
    return `Band ${index + 1} · above ${money(previous)}`;
  }
  const limit = majorToMinor(bands[index]!.upTo, exponent);
  if (limit == null) return `Band ${index + 1}`;
  return `Band ${index + 1} · up to ${money(limit)} per night`;
}

function configValue(data: { keys?: unknown } | undefined, key: string): unknown {
  const keys = data?.keys;
  if (!Array.isArray(keys)) return undefined;
  for (const row of keys) {
    if (row && typeof row === 'object' && 'key' in row && row.key === key && 'value' in row) {
      return row.value;
    }
  }
  return undefined;
}

function readLocation(value: unknown): LocationValue {
  if (!value || typeof value !== 'object') return { country: '', region: '', locality: '' };
  const row = value as Record<string, unknown>;
  return {
    country: typeof row.country === 'string' ? row.country : '',
    region: typeof row.region === 'string' ? row.region : '',
    locality: typeof row.locality === 'string' ? row.locality : '',
  };
}

function readRegistrations(value: unknown): Registration[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const label = 'label' in row && typeof row.label === 'string' ? row.label : '';
    const number = 'number' in row && typeof row.number === 'string' ? row.number : '';
    return [{ label, number }];
  });
}

function readChargeCodes(data: { codes?: unknown } | undefined): ChargeCodeRow[] {
  if (!data || !Array.isArray(data.codes)) return [];
  return data.codes.flatMap((row) => {
    if (!row || typeof row !== 'object' || !('code' in row) || typeof row.code !== 'string' || !row.code) {
      return [];
    }
    const name = 'name' in row && typeof row.name === 'string' ? row.name : row.code;
    const status = 'status' in row && typeof row.status === 'string' ? row.status : 'active';
    const taxGroup = 'taxGroup' in row && typeof row.taxGroup === 'string' ? row.taxGroup : null;
    return [{ code: row.code, name, status, taxGroup }];
  });
}

function outputCatalog(codes: ChargeCodeRow[], productCodes: ReadonlySet<string>): ChargeCodeRow[] {
  return codes.filter(
    (row) =>
      row.status === 'active' &&
      (row.taxGroup == null || row.taxGroup === '') &&
      !SYSTEM_CHARGE_CODES.has(row.code) &&
      !productCodes.has(row.code),
  );
}

function mergeOutputCodes(
  catalog: ChargeCodeRow[],
  selected: string[],
  productCodes: ReadonlySet<string>,
): ChargeCodeRow[] {
  const byCode = new Map(catalog.map((row) => [row.code, row]));
  for (const code of selected) {
    if (!code || byCode.has(code) || SYSTEM_CHARGE_CODES.has(code) || productCodes.has(code)) continue;
    byCode.set(code, { code, name: code, status: 'active', taxGroup: null });
  }
  return [...byCode.values()];
}

function productChargeCodes(data: { items?: unknown } | undefined): Set<string> {
  if (!data || !Array.isArray(data.items)) return new Set();
  const codes = new Set<string>();
  for (const item of data.items) {
    if (
      item &&
      typeof item === 'object' &&
      'chargeCode' in item &&
      typeof item.chargeCode === 'string' &&
      item.chargeCode
    ) {
      codes.add(item.chargeCode);
    }
  }
  return codes;
}

function countryForSave(raw: string): string {
  const trimmed = raw.trim();
  return /^[A-Za-z]{2}$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

function Muted({ muted, children }: { muted: boolean; children: ReactNode }) {
  if (!muted) return <>{children}</>;
  return <span className="muted">{children}</span>;
}

export function SettingsTaxTab({ propertyId }: { propertyId: string }) {
  const { date, money, fmt } = useFormat();
  const exponent = currencyMinorExponent(fmt.currency);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [preset, setPreset] = useState('custom');
  const [mode, setMode] = useState<EditorMode>({ kind: 'create' });
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [errors, setErrors] = useState<DraftErrors>(EMPTY_ERRORS);
  const [locationDraft, setLocationDraft] = useState<LocationValue | null>(null);
  const [regDraft, setRegDraft] = useState<Registration[] | null>(null);
  const [locationReason, setLocationReason] = useState('');
  const [locationErrors, setLocationErrors] = useState<{ country?: string; reason?: string }>({});
  const [declKey, setDeclKey] = useState('');
  const [declValue, setDeclValue] = useState('');
  const [declFrom, setDeclFrom] = useState('');
  const [stopTarget, setStopTarget] = useState<TaxRuleRow | null>(null);
  const [stopOn, setStopOn] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const taxQ = useQuery({
    queryKey: ['tax-rules', propertyId],
    queryFn: () => api.listTaxRules(propertyId),
    retry: false,
  });
  const declQ = useQuery({
    queryKey: ['tax-declarations', propertyId],
    queryFn: () => api.listTaxDeclarations(propertyId),
    retry: false,
  });
  const configQ = useQuery({
    queryKey: ['domain-config', propertyId],
    queryFn: () => api.listDomainConfig(propertyId),
    retry: false,
  });
  const codesQ = useQuery({
    queryKey: ['charge-codes', propertyId],
    queryFn: () => api.listChargeCodes(propertyId, { status: 'all' }),
    retry: false,
  });
  const productsQ = useQuery({
    queryKey: productsQueryKey(propertyId, 'all'),
    queryFn: () => api.listProducts(propertyId, { status: 'all' }),
    retry: false,
  });

  const rules = (Array.isArray(taxQ.data?.rules) ? taxQ.data.rules : []) as TaxRuleRow[];
  const declarations = (
    Array.isArray(declQ.data?.declarations) ? declQ.data.declarations : []
  ) as DeclarationRow[];
  const savedLocation = readLocation(configValue(configQ.data, 'pms.tax.location'));
  const savedRegistrations = readRegistrations(configValue(configQ.data, 'pms.tax.registrations'));
  const location = locationDraft ?? savedLocation;
  const registrations = regDraft ?? savedRegistrations;
  const productCodes = useMemo(() => productChargeCodes(productsQ.data), [productsQ.data]);
  const catalog = outputCatalog(readChargeCodes(codesQ.data), productCodes);
  const codeChoices = mergeOutputCodes(
    catalog,
    draft.bands.flatMap((band) => band.parts.map((part) => part.code)),
    productCodes,
  );
  const useCodeSelect = catalog.length > 0;
  const declarationKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of declarations) if (row.declarationKey) keys.add(row.declarationKey);
    if (draft.conditionKey) keys.add(draft.conditionKey);
    return [...keys].sort((a, b) => a.localeCompare(b));
  }, [declarations, draft.conditionKey]);
  const grouped = useMemo(() => {
    const by = new Map<string, TaxRuleRow[]>();
    for (const rule of rules) {
      const list = by.get(rule.taxGroup) ?? [];
      list.push(rule);
      by.set(rule.taxGroup, list);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rules]);

  function noteFrom(result: unknown) {
    if (isQueuedResult(result)) {
      setNotice({ intent: 'attention', text: queuedWriteCopy() });
      return;
    }
    setNotice({ intent: 'settled', text: 'Saved.' });
  }

  function fail(err: unknown) {
    setNotice({ intent: 'exception', text: classifiedUserMessage(asClassified(err), {}) });
  }

  function patchDraft(partial: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...partial }));
    setErrors(EMPTY_ERRORS);
  }

  function replaceBands(bands: BandDraft[]) {
    setDraft((current) => ({ ...current, bands }));
    setErrors(EMPTY_ERRORS);
  }

  function applyPreset(next: string) {
    setPreset(next);
    if (next === 'custom') {
      setDraft(blankDraft());
      setMode({ kind: 'create' });
      setErrors(EMPTY_ERRORS);
      return;
    }
    const keptName = mode.kind === 'change' ? draft.name : '';
    const shared: Draft = {
      ...blankDraft(),
      name: keptName,
      priceMode: 'EXCLUSIVE',
      sequence: '0',
      base: 'NET',
      rebands: 'yes',
      validFrom: '',
    };
    if (next === 'india-room') {
      setDraft({
        ...shared,
        taxGroup: 'ROOM',
        conditionKey: '',
        conditionValue: '',
        bands: [gstBand(), gstBand()],
      });
    } else {
      setDraft({
        ...shared,
        taxGroup: 'FNB',
        conditionKey: 'specified_premises',
        conditionValue: 'yes',
        bands: [gstBand()],
      });
    }
    setErrors(EMPTY_ERRORS);
  }

  function startChange(rule: TaxRuleRow) {
    const next = draftFromRule(rule, exponent);
    if (next.bands.every((band) => band.parts.length === 0)) {
      next.bands = [{ upTo: '', parts: [blankPart()] }];
    }
    setDraft(next);
    setMode({ kind: 'change', ruleKey: rule.ruleKey, name: rule.name });
    setPreset('custom');
    setErrors(EMPTY_ERRORS);
  }

  function cancelChange() {
    setDraft(blankDraft());
    setMode({ kind: 'create' });
    setPreset('custom');
    setErrors(EMPTY_ERRORS);
  }

  useEffect(() => {
    if (mode.kind !== 'change') return;
    const editor = editorRef.current;
    if (editor && typeof editor.scrollIntoView === 'function') {
      editor.scrollIntoView({ block: 'start' });
    }
    nameRef.current?.focus();
  }, [mode]);

  const saveRule = useMutation({
    mutationFn: (input: { mode: EditorMode; write: TaxWrite }) => {
      if (input.mode.kind === 'change') {
        return api.supersedeTaxRule(propertyId, input.mode.ruleKey, {
          ...input.write,
          taxRuleId: crypto.randomUUID(),
          ruleKey: input.mode.ruleKey,
        });
      }
      return api.createTaxRule(propertyId, {
        ...input.write,
        taxRuleId: crypto.randomUUID(),
        ruleKey: ruleKeyFromName(input.write.name),
      });
    },
    onSuccess: async (result) => {
      noteFrom(result);
      setDraft(blankDraft());
      setMode({ kind: 'create' });
      setPreset('custom');
      setErrors(EMPTY_ERRORS);
      await queryClient.invalidateQueries({ queryKey: ['tax-rules', propertyId] });
    },
    onError: fail,
  });

  const endRule = useMutation({
    mutationFn: (input: { ruleKey: string; validTo: string }) =>
      api.endTaxRule(propertyId, input.ruleKey, { validTo: input.validTo }),
    onSuccess: async (result) => {
      if (isQueuedResult(result)) {
        setNotice({ intent: 'attention', text: queuedWriteCopy() });
      } else {
        setNotice({ intent: 'settled', text: 'Stopped.' });
      }
      setStopTarget(null);
      setStopOn('');
      await queryClient.invalidateQueries({ queryKey: ['tax-rules', propertyId] });
    },
    onError: fail,
  });

  function confirmStop() {
    if (!stopTarget || endRule.isPending) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stopOn)) return;
    setNotice(null);
    endRule.mutate({ ruleKey: stopTarget.ruleKey, validTo: stopOn });
  }

  const saveLocation = useMutation({
    mutationFn: async (input: LocationSave) => {
      const savedLocationResult = await api.putDomainConfig(propertyId, {
        key: 'pms.tax.location',
        value: { country: input.country, region: input.region, locality: input.locality },
        reason: input.reason,
      });
      const savedRegistrationsResult = await api.putDomainConfig(propertyId, {
        key: 'pms.tax.registrations',
        value: input.registrations,
        reason: input.reason,
      });
      return { savedLocationResult, savedRegistrationsResult };
    },
    onSuccess: async (result) => {
      if (isQueuedResult(result.savedLocationResult) || isQueuedResult(result.savedRegistrationsResult)) {
        setNotice({ intent: 'attention', text: queuedWriteCopy() });
      } else {
        setNotice({ intent: 'settled', text: 'Saved.' });
      }
      await queryClient.invalidateQueries({ queryKey: ['domain-config', propertyId] });
    },
    onError: fail,
  });

  const saveDeclaration = useMutation({
    mutationFn: () =>
      api.setTaxDeclaration(propertyId, {
        declarationId: crypto.randomUUID(),
        declarationKey: declKey.trim(),
        value: declValue.trim(),
        validFrom: declFrom,
      }),
    onSuccess: async (result) => {
      noteFrom(result);
      setDeclKey('');
      setDeclValue('');
      setDeclFrom('');
      await queryClient.invalidateQueries({ queryKey: ['tax-declarations', propertyId] });
    },
    onError: fail,
  });

  function onSaveRule(event: FormEvent) {
    event.preventDefault();
    if (saveRule.isPending) return;
    setNotice(null);
    const validated = validateDraft(draft, exponent);
    setErrors(validated.errors);
    if (!validated.write) return;
    saveRule.mutate({ mode, write: validated.write });
  }

  function onSaveLocation(event: FormEvent) {
    event.preventDefault();
    if (saveLocation.isPending) return;
    const country = countryForSave(location.country);
    const nextErrors: { country?: string; reason?: string } = {};
    if (country !== '' && !/^[A-Z]{2}$/.test(country)) {
      nextErrors.country = 'Enter a two-letter country code, such as IN.';
    }
    if (!locationReason.trim()) nextErrors.reason = 'Enter a reason.';
    setLocationErrors(nextErrors);
    if (nextErrors.country || nextErrors.reason) return;
    setNotice(null);
    saveLocation.mutate({
      country,
      region: location.region.trim() || null,
      locality: location.locality.trim() || null,
      registrations: registrations
        .map((row) => ({ label: row.label.trim(), number: row.number.trim() }))
        .filter((row) => row.label && row.number),
      reason: locationReason.trim(),
    });
  }

  const locationUntouched = locationDraft == null && regDraft == null;
  const locationBlocked =
    saveLocation.isPending || configQ.isPending || (configQ.isError && locationUntouched);
  const editorTitle =
    mode.kind === 'change' ? `Change ${draft.name.trim() || mode.name} from a date` : 'Add a tax';
  const limitCount = Math.max(0, draft.bands.length - 1);

  return (
    <>
      {notice ? <Alert intent={notice.intent}>{notice.text}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>Where this property is taxed</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="ui-stack" onSubmit={onSaveLocation}>
            <div className="tax-location-fields">
            <FieldGroup inline>
              <Field
                label="Country"
                error={locationErrors.country}
                control={
                  <Input
                    value={location.country}
                    onChange={(event) => {
                      setLocationDraft({ ...location, country: event.target.value });
                      setLocationErrors((current) => ({ ...current, country: undefined }));
                    }}
                    autoComplete="off"
                  />
                }
              />
              <Field
                label="State or region"
                control={
                  <Input
                    value={location.region}
                    onChange={(event) => setLocationDraft({ ...location, region: event.target.value })}
                    autoComplete="off"
                  />
                }
              />
              <Field
                label="City"
                control={
                  <Input
                    value={location.locality}
                    onChange={(event) => setLocationDraft({ ...location, locality: event.target.value })}
                    autoComplete="off"
                  />
                }
              />
            </FieldGroup>
            <p className="muted">Country is a two-letter code, such as IN.</p>
            </div>
            {registrations.map((row, index) => (
              <FieldGroup inline key={index}>
                <Field
                  label="Registration name"
                  control={
                    <Input
                      placeholder="GSTIN"
                      value={row.label}
                      onChange={(event) => {
                        const next = registrations.slice();
                        next[index] = { ...row, label: event.target.value };
                        setRegDraft(next);
                      }}
                      autoComplete="off"
                    />
                  }
                />
                <Field
                  label="Registration number"
                  control={
                    <Input
                      value={row.number}
                      onChange={(event) => {
                        const next = registrations.slice();
                        next[index] = { ...row, number: event.target.value };
                        setRegDraft(next);
                      }}
                      autoComplete="off"
                    />
                  }
                />
                <Button
                  type="button"
                  onClick={() => setRegDraft(registrations.filter((_, rowIndex) => rowIndex !== index))}
                >
                  Remove
                </Button>
              </FieldGroup>
            ))}
            {registrations.length < 4 ? (
              <Button
                type="button"
                onClick={() => setRegDraft([...registrations, { label: '', number: '' }])}
              >
                Add registration
              </Button>
            ) : null}
            <Field
              label="Reason"
              error={locationErrors.reason}
              control={
                <Input
                  value={locationReason}
                  onChange={(event) => {
                    setLocationReason(event.target.value);
                    setLocationErrors((current) => ({ ...current, reason: undefined }));
                  }}
                  autoComplete="off"
                />
              }
            />
            <Button type="submit" intent="primary" disabled={locationBlocked}>
              Save location
            </Button>
          </form>
          {configQ.isError ? (
            <Alert intent="exception">{classifiedUserMessage(asClassified(configQ.error), {})}</Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Declarations</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="ui-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (saveDeclaration.isPending) return;
              setNotice(null);
              saveDeclaration.mutate();
            }}
          >
            <FieldGroup inline>
              <Field
                label="Declaration"
                hint="For example, specified_premises"
                control={
                  <Input value={declKey} onChange={(event) => setDeclKey(event.target.value)} autoComplete="off" />
                }
              />
              <Field
                label="Value"
                control={
                  <Input
                    value={declValue}
                    onChange={(event) => setDeclValue(event.target.value)}
                    autoComplete="off"
                  />
                }
              />
              <Field
                label="From"
                control={
                  <Input
                    type="date"
                    value={declFrom}
                    onChange={(event) => setDeclFrom(event.target.value)}
                    autoComplete="off"
                  />
                }
              />
            </FieldGroup>
            <Button type="submit" disabled={saveDeclaration.isPending}>
              Save declaration
            </Button>
          </form>
          {declQ.isError ? (
            <Alert intent="exception">{classifiedUserMessage(asClassified(declQ.error), {})}</Alert>
          ) : null}
          {declarations.length === 0 ? null : (
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Declaration</DataTableHeaderCell>
                  <DataTableHeaderCell>Value</DataTableHeaderCell>
                  <DataTableHeaderCell>From</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {declarations.map((row) => (
                  <DataTableRow key={row.declarationId}>
                    <DataTableCell>{row.declarationKey}</DataTableCell>
                    <DataTableCell>{row.value}</DataTableCell>
                    <DataTableCell>{date(row.validFrom)}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          )}
        </CardContent>
      </Card>

      <div ref={editorRef}>
      <Card>
        <CardHeader>
          <CardTitle>{editorTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="ui-stack" onSubmit={onSaveRule}>
            <Field
              label="Preset"
              hint={PRESET_HINT}
              control={
                <NativeSelect value={preset} onChange={(event) => applyPreset(event.target.value)}>
                  <option value="custom">Custom</option>
                  <option value="india-room">India — GST, room</option>
                  <option value="india-fnb">India — GST, food and beverage</option>
                </NativeSelect>
              }
            />
            <FieldGroup inline>
              <Field
                label="Name"
                error={errors.name}
                control={
                  <Input
                    ref={nameRef}
                    placeholder="City tax"
                    value={draft.name}
                    onChange={(event) => patchDraft({ name: event.target.value })}
                    autoComplete="off"
                  />
                }
              />
              <Field
                label="Product group"
                error={errors.taxGroup}
                control={
                  <Input
                    value={draft.taxGroup}
                    onChange={(event) => patchDraft({ taxGroup: event.target.value })}
                    autoComplete="off"
                  />
                }
              />
              <Field
                label="Starts on"
                error={errors.validFrom}
                control={
                  <Input
                    type="date"
                    value={draft.validFrom}
                    onChange={(event) => patchDraft({ validFrom: event.target.value })}
                    autoComplete="off"
                  />
                }
              />
            </FieldGroup>
            <FieldGroup inline>
              <Field
                label="Price"
                control={
                  <NativeSelect
                    value={draft.priceMode}
                    onChange={(event) => patchDraft({ priceMode: event.target.value as PriceMode })}
                  >
                    <option value="EXCLUSIVE">Added on top</option>
                    <option value="INCLUSIVE">Included in the price</option>
                  </NativeSelect>
                }
              />
              <Field
                label="Order"
                hint="Lower numbers apply first"
                error={errors.sequence}
                control={
                  <Input
                    value={draft.sequence}
                    onChange={(event) => patchDraft({ sequence: event.target.value })}
                    autoComplete="off"
                  />
                }
              />
              <Field
                label="Calculated on"
                error={errors.base}
                control={
                  <NativeSelect
                    value={draft.base}
                    onChange={(event) => patchDraft({ base: event.target.value as TaxBase })}
                  >
                    <option value="NET">Price</option>
                    <option value="NET_PLUS_PRIOR">Price plus taxes earlier in the order</option>
                  </NativeSelect>
                }
              />
              <Field
                label="A discount can move a night to another band"
                control={
                  <NativeSelect
                    value={draft.rebands}
                    onChange={(event) => patchDraft({ rebands: event.target.value === 'no' ? 'no' : 'yes' })}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </NativeSelect>
                }
              />
            </FieldGroup>
            <FieldGroup inline>
              <Field
                label="Applies when"
                control={
                  <NativeSelect
                    value={draft.conditionKey}
                    onChange={(event) => {
                      const key = event.target.value;
                      setDraft((current) => ({
                        ...current,
                        conditionKey: key,
                        conditionValue: key ? current.conditionValue : '',
                      }));
                      setErrors(EMPTY_ERRORS);
                    }}
                  >
                    <option value="">Always applies</option>
                    {declarationKeys.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              {draft.conditionKey ? (
                <Field
                  label="Value"
                  error={errors.conditionValue}
                  control={
                    <Input
                      value={draft.conditionValue}
                      onChange={(event) => patchDraft({ conditionValue: event.target.value })}
                      autoComplete="off"
                    />
                  }
                />
              ) : null}
            </FieldGroup>
            {draft.bands.map((band, bandIndex) => {
              const last = bandIndex === draft.bands.length - 1;
              return (
                <div className="tax-band" key={bandIndex}>
                  <p className="tax-band__heading">{bandHeading(draft.bands, bandIndex, money, exponent)}</p>
                  {last ? null : (
                    <Field
                      label={limitFieldLabel(fmt.currency, bandIndex, limitCount)}
                      error={errors.limits[String(bandIndex)]}
                      control={
                        <Input
                          value={band.upTo}
                          onChange={(event) => {
                            const bands = draft.bands.map((row, index) =>
                              index === bandIndex ? { ...row, upTo: event.target.value } : row,
                            );
                            replaceBands(bands);
                          }}
                          autoComplete="off"
                        />
                      }
                    />
                  )}
                  {band.parts.map((part, partIndex) => {
                    const partError = errors.parts[partKey(bandIndex, partIndex)];
                    return (
                      <FieldGroup inline key={partIndex}>
                        <Field
                          label={partFieldLabel(
                            draft.bands.length,
                            bandIndex,
                            band.parts.length,
                            partIndex,
                            'code',
                          )}
                          error={partError?.code}
                          control={
                            useCodeSelect ? (
                              <NativeSelect
                                value={part.code}
                                onChange={(event) => {
                                  const bands = draft.bands.map((row, index) =>
                                    index === bandIndex
                                      ? {
                                          ...row,
                                          parts: row.parts.map((item, itemIndex) =>
                                            itemIndex === partIndex ? { ...item, code: event.target.value } : item,
                                          ),
                                        }
                                      : row,
                                  );
                                  replaceBands(bands);
                                }}
                              >
                                <option value="">Choose</option>
                                {codeChoices.map((choice) => (
                                  <option key={choice.code} value={choice.code}>
                                    {`${choice.code} · ${choice.name}`}
                                  </option>
                                ))}
                              </NativeSelect>
                            ) : (
                              <Input
                                value={part.code}
                                onChange={(event) => {
                                  const bands = draft.bands.map((row, index) =>
                                    index === bandIndex
                                      ? {
                                          ...row,
                                          parts: row.parts.map((item, itemIndex) =>
                                            itemIndex === partIndex ? { ...item, code: event.target.value } : item,
                                          ),
                                        }
                                      : row,
                                  );
                                  replaceBands(bands);
                                }}
                                autoComplete="off"
                              />
                            )
                          }
                        />
                        <Field
                          label={partFieldLabel(
                            draft.bands.length,
                            bandIndex,
                            band.parts.length,
                            partIndex,
                            'rate',
                          )}
                          error={partError?.percent}
                          control={
                            <Input
                              value={part.percent}
                              onChange={(event) => {
                                const bands = draft.bands.map((row, index) =>
                                  index === bandIndex
                                    ? {
                                        ...row,
                                        parts: row.parts.map((item, itemIndex) =>
                                          itemIndex === partIndex ? { ...item, percent: event.target.value } : item,
                                        ),
                                      }
                                    : row,
                                );
                                replaceBands(bands);
                              }}
                              autoComplete="off"
                            />
                          }
                        />
                        {band.parts.length > 1 ? (
                          <Button
                            type="button"
                            onClick={() => {
                              const bands = draft.bands.map((row, index) =>
                                index === bandIndex
                                  ? { ...row, parts: row.parts.filter((_, itemIndex) => itemIndex !== partIndex) }
                                  : row,
                              );
                              replaceBands(bands);
                            }}
                          >
                            Remove part
                          </Button>
                        ) : null}
                      </FieldGroup>
                    );
                  })}
                  <p className="muted tax-band__hint">Tax line codes are set up under Charges.</p>
                  {band.parts.length < MAX_PARTS || draft.bands.length > 1 ? (
                    <div className="tax-band__actions">
                      {band.parts.length < MAX_PARTS ? (
                        <Button
                          type="button"
                          onClick={() => {
                            const bands = draft.bands.map((row, index) =>
                              index === bandIndex ? { ...row, parts: [...row.parts, blankPart()] } : row,
                            );
                            replaceBands(bands);
                          }}
                        >
                          Add part
                        </Button>
                      ) : null}
                      {draft.bands.length > 1 ? (
                        <Button
                          type="button"
                          onClick={() => {
                            const bands = draft.bands.filter((_, index) => index !== bandIndex);
                            const next = bands.length > 0 ? bands : blankDraft().bands;
                            const lastIndex = next.length - 1;
                            replaceBands(next.map((row, index) => (index === lastIndex ? { ...row, upTo: '' } : row)));
                          }}
                        >
                          Remove band
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {draft.bands.length < MAX_BANDS ? (
              <Button
                type="button"
                onClick={() => {
                  const previous = draft.bands[draft.bands.length - 1];
                  if (!previous) return;
                  replaceBands([
                    ...draft.bands,
                    {
                      upTo: '',
                      parts: previous.parts.map((part) => ({ code: part.code, percent: '' })),
                    },
                  ]);
                }}
              >
                Add band
              </Button>
            ) : null}
            <FieldGroup inline>
              <Button type="submit" intent="primary" disabled={saveRule.isPending}>
                Save
              </Button>
              {mode.kind === 'change' ? (
                <Button type="button" onClick={cancelChange} disabled={saveRule.isPending}>
                  Cancel
                </Button>
              ) : null}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Taxes</CardTitle>
        </CardHeader>
        {taxQ.isPending ? (
          <CardContent>
            <Skeleton label="Loading taxes" lines={4} />
          </CardContent>
        ) : taxQ.isError ? (
          <CardContent>
            <Alert intent="exception">{classifiedUserMessage(asClassified(taxQ.error), {})}</Alert>
          </CardContent>
        ) : (
          <CardContent flush>
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Price</DataTableHeaderCell>
                  <DataTableHeaderCell>Rates</DataTableHeaderCell>
                  <DataTableHeaderCell>Order</DataTableHeaderCell>
                  <DataTableHeaderCell>Applies when</DataTableHeaderCell>
                  <DataTableHeaderCell>In force</DataTableHeaderCell>
                  <DataTableHeaderCell>
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {grouped.flatMap(([group, groupRules]) => [
                  <DataTableRow key={`group:${group}`}>
                    <DataTableCell colSpan={7}>{group}</DataTableCell>
                  </DataTableRow>,
                  ...groupRules.map((rule) => {
                    const superseded = rule.validTo != null && rule.validTo !== '';
                    const applies =
                      rule.conditionKey && rule.conditionValue
                        ? `${rule.conditionKey} = ${rule.conditionValue}`
                        : '—';
                    return (
                      <DataTableRow key={rule.taxRuleId}>
                        <DataTableCell>
                          <Muted muted={superseded}>{rule.name}</Muted>
                        </DataTableCell>
                        <DataTableCell>
                          <Muted muted={superseded}>{priceLabel(rule.priceMode)}</Muted>
                        </DataTableCell>
                        <DataTableCell>
                          <div className={superseded ? 'muted' : undefined}>
                            {rateLines(rule, money).map((line, index) => (
                              <div key={`${rule.taxRuleId}:${index}`}>{line}</div>
                            ))}
                          </div>
                        </DataTableCell>
                        <DataTableCell>
                          <Muted muted={superseded}>{rule.sequence == null ? '—' : String(rule.sequence)}</Muted>
                        </DataTableCell>
                        <DataTableCell>
                          <Muted muted={superseded}>{applies}</Muted>
                        </DataTableCell>
                        <DataTableCell>
                          <Muted muted={superseded}>
                            {date(rule.validFrom)}
                            {rule.validTo ? ` – ${date(rule.validTo)}` : ' – open'}
                          </Muted>
                        </DataTableCell>
                        <DataTableCell>
                          {superseded ? null : (
                            <RowActions>
                              <Button type="button" onClick={() => startChange(rule)}>
                                Change from a date
                              </Button>
                              <Button
                                type="button"
                                intent="destructive"
                                onClick={() => {
                                  setStopTarget(rule);
                                  setStopOn('');
                                  setNotice(null);
                                }}
                              >
                                Stop from a date
                              </Button>
                            </RowActions>
                          )}
                        </DataTableCell>
                      </DataTableRow>
                    );
                  }),
                ])}
              </DataTableBody>
            </DataTable>
          </CardContent>
        )}
        <CardContent>
          <p className="muted">{POSTED_NOTE}</p>
        </CardContent>
      </Card>
      <Dialog
        open={stopTarget != null}
        title={stopTarget ? `Stop ${stopTarget.name}` : 'Stop tax'}
        onClose={() => {
          if (endRule.isPending) return;
          setStopTarget(null);
          setStopOn('');
        }}
        footer={
          <>
            <Button
              type="button"
              disabled={endRule.isPending}
              onClick={() => {
                setStopTarget(null);
                setStopOn('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              intent="destructive"
              disabled={endRule.isPending || !/^\d{4}-\d{2}-\d{2}$/.test(stopOn)}
              onClick={confirmStop}
            >
              {stopTarget ? `Stop ${stopTarget.name}` : 'Stop'}
            </Button>
          </>
        }
      >
        {stopTarget ? (
          <Field
            label="Stops on"
            hint={`Charges posted on or after this date get no ${stopTarget.name}. Charges already posted keep their tax.`}
            control={
              <Input
                type="date"
                value={stopOn}
                onChange={(event) => setStopOn(event.target.value)}
                autoComplete="off"
              />
            }
          />
        ) : null}
      </Dialog>
    </>
  );
}
