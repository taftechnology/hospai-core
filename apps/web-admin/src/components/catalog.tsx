import { Alert, Field, NativeSelect } from '@hospai/ui-kit';
import type { OpsCatalog } from '@hospai/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { opsErrorMessage } from '../api/client.js';

export type CatalogOption = { code: string; label: string; disabled?: boolean };

export const hotelCount = (limit: number | null): string =>
  limit === null ? 'unlimited hotels' : `${limit} ${limit === 1 ? 'hotel' : 'hotels'}`;

/** `<name> (<code>) · <n> hotel(s)` or `... · unlimited hotels`. */
export function planOptions(catalog: OpsCatalog | undefined, currentCode?: string | null): CatalogOption[] {
  return (catalog?.plans ?? []).map((p) => {
    const current = p.code === currentCode;
    return {
      code: p.code,
      label: `${p.name} (${p.code}) · ${hotelCount(p.propertiesLimit)}${current ? ' (current)' : ''}`,
      disabled: current,
    };
  });
}

export function addonOptions(catalog: OpsCatalog | undefined): CatalogOption[] {
  return (catalog?.addons ?? []).map((a) => ({ code: a.code, label: `${a.name} (${a.code})` }));
}

/**
 * A select over the plans or add-ons that exist. While the list loads the select is disabled; if the
 * load fails or the list is empty, a plain Alert replaces it. `blocked` tells the form to hold submit.
 */
export function CatalogField(props: {
  label: string;
  noun: string;
  hint?: string;
  catalog: UseQueryResult<OpsCatalog>;
  options: CatalogOption[];
  placeholder: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const { catalog, options } = props;
  if (catalog.isError) {
    return (
      <Alert intent="exception">
        The list of {props.noun}s could not be loaded. {opsErrorMessage(catalog.error)}
      </Alert>
    );
  }
  if (catalog.data && options.length === 0) {
    return <Alert intent="attention">There are no {props.noun}s in the catalog yet, so none can be chosen.</Alert>;
  }
  const loading = catalog.isPending;
  return (
    <Field
      label={props.label}
      hint={props.hint}
      size="lg"
      control={
        <NativeSelect value={props.value} disabled={loading} onChange={(e) => props.onChange(e.target.value)}>
          <option value="">{loading ? `Loading ${props.noun}s` : props.placeholder}</option>
          {options.map((o) => (
            <option key={o.code} value={o.code} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      }
    />
  );
}

/** True while the form cannot be sent: the list is loading, failed, or empty. */
export const catalogBlocked = (catalog: UseQueryResult<OpsCatalog>, options: CatalogOption[]): boolean =>
  !catalog.data || options.length === 0;
