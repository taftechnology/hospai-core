import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import {
  FORM_C_KIND_LABELS,
  FORM_C_REGISTER_FILTER_LABELS,
  FORM_C_REGISTER_FILTERS,
  type FormCRegisterFilter,
} from '@hospai/contracts';
import {
  Alert,
  Button,
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
  EmptyState,
  Field,
  NativeSelect,
  PageHeader,
  Skeleton,
  Toolbar,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import {
  FormCDeadlineCell,
  FormCNameCell,
  formCRegisterKey,
  formCStatusBadge,
  useFormCApplicable,
} from './form-c.js';

function asFilter(raw: string | null): FormCRegisterFilter {
  return (FORM_C_REGISTER_FILTERS as readonly string[]).includes(raw ?? '')
    ? (raw as FormCRegisterFilter)
    : 'to_file';
}

/**
 * Form C register (R6.2): every foreign national the property has to report, with the 24-hour
 * deadline. Names come from one OrgDO summary batch; opening a record's details is audited and
 * happens on the stay card.
 */
export function FormCScreen() {
  const propertyId = tenant.propertyId;
  const applicable = useFormCApplicable();
  const [params, setParams] = useSearchParams();
  const filter = asFilter(params.get('filter'));
  const { subtitle } = usePropertySubtitle('Foreign national arrivals');

  const registerQ = useQuery({
    queryKey: formCRegisterKey(propertyId, filter),
    queryFn: () => api.getFormCRegister(propertyId, filter),
    enabled: applicable,
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });
  const rows = registerQ.data?.rows ?? [];

  if (!applicable) {
    return (
      <div className="board-page">
        <PageHeader title="Form C" subtitle={subtitle} />
        <Card>
          <CardContent>
            <EmptyState
              kind="empty"
              data-testid="form-c-not-applicable"
              title="Form C applies to properties in India."
              description="Set the property's tax location to India in Settings to track foreign national arrivals."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  let body;
  if (registerQ.isError) {
    body = (
      <Alert data-testid="form-c-register-error">
        {classifiedUserMessage(asClassified(registerQ.error), {
          fallback: 'Could not load the Form C register.',
        })}
      </Alert>
    );
  } else if (registerQ.isLoading) {
    body = <Skeleton label="Loading the Form C register" lines={4} />;
  } else if (rows.length === 0 && filter === 'all') {
    body = (
      <EmptyState
        kind="empty"
        data-testid="form-c-register-empty"
        title="No Form C records yet."
        description="A record appears when a guest with a foreign passport checks in, or when you add a foreign national on a stay."
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        kind="nomatch"
        data-testid="form-c-register-nomatch"
        title="No records match this filter."
        action={
          <Button type="button" onClick={() => setParams({ filter: 'all' })}>
            Show all records
          </Button>
        }
      />
    );
  } else {
    body = (
      <DataTable data-testid="form-c-register-table">
        <DataTableHead>
          <DataTableRow>
            <DataTableHeaderCell>Name</DataTableHeaderCell>
            <DataTableHeaderCell>Nationality</DataTableHeaderCell>
            <DataTableHeaderCell>Kind</DataTableHeaderCell>
            <DataTableHeaderCell>File by</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
            <DataTableHeaderCell>Stay</DataTableHeaderCell>
          </DataTableRow>
        </DataTableHead>
        <DataTableBody>
          {rows.map((row) => (
            <DataTableRow key={row.recordId} data-testid={`form-c-register-row-${row.recordId}`}>
              <DataTableCell>
                <FormCNameCell row={row} />
              </DataTableCell>
              <DataTableCell>{row.nationality ?? '—'}</DataTableCell>
              <DataTableCell>{FORM_C_KIND_LABELS[row.kind]}</DataTableCell>
              <DataTableCell>
                <FormCDeadlineCell row={row} />
              </DataTableCell>
              <DataTableCell>
                {formCStatusBadge(row)}
                {row.filedReference ? <span className="muted"> {row.filedReference}</span> : null}
              </DataTableCell>
              <DataTableCell>
                <Link
                  className="ui-link-btn ui-link-btn--sm"
                  to={`/reservations/${encodeURIComponent(row.reservationId)}`}
                >
                  Open stay
                </Link>
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    );
  }

  return (
    <div className="board-page">
      <PageHeader title="Form C" subtitle={subtitle} />
      <Card>
        <Toolbar>
          <Field
            label="Show"
            control={
              <NativeSelect
                data-testid="form-c-filter"
                value={filter}
                onChange={(e) => setParams({ filter: e.target.value })}
              >
                {FORM_C_REGISTER_FILTERS.map((f) => (
                  <option key={f} value={f}>
                    {FORM_C_REGISTER_FILTER_LABELS[f]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
        </Toolbar>
        <CardHeader>
          <CardTitle>{FORM_C_REGISTER_FILTER_LABELS[filter]}</CardTitle>
        </CardHeader>
        <CardContent flush>{body}</CardContent>
      </Card>
    </div>
  );
}
