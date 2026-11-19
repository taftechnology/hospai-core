import { useQuery } from '@tanstack/react-query';
import { api } from '../client.js';
import { usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { propertyLocalToday } from '../status/property-local-today.js';

type RoomTaxRule = { name?: string; priceMode?: string; validFrom?: string; validTo?: string | null };

/** Rules in force on `today`; with no date yet, the open version of each rule. */
export function roomRulesInForce(rules: RoomTaxRule[], today: string | null): RoomTaxRule[] {
  if (!today) return rules.filter((rule) => rule.validTo == null);
  return rules.filter(
    (rule) => (rule.validFrom ?? '') <= today && (rule.validTo == null || rule.validTo > today),
  );
}

/** One line of included/added copy from the room group's rules in force today. A failed read shows nothing. */
export function TaxInclusionNote({ propertyId }: { propertyId: string }) {
  const timeZone = usePropertyTimeZone();
  const rulesQ = useQuery({
    queryKey: ['tax-rules', propertyId, 'ROOM'],
    queryFn: async () => {
      try {
        return await api.listTaxRules(propertyId, { taxGroup: 'ROOM' });
      } catch {
        return { ok: true as const, rules: [] as RoomTaxRule[] };
      }
    },
    retry: false,
  });
  const today = timeZone ? propertyLocalToday(timeZone) : null;
  const rules = roomRulesInForce((rulesQ.data?.rules ?? []) as RoomTaxRule[], today);
  if (rules.length === 0) return null;
  return (
    <p className="muted">
      {`${rules
        .map((rule) =>
          rule.priceMode === 'INCLUSIVE'
            ? `${rule.name ?? 'Tax'} is included in the price`
            : `${rule.name ?? 'Tax'} is added on top`,
        )
        .join('. ')}.`}
    </p>
  );
}
