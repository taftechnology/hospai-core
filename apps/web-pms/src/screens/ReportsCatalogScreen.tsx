import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  MANAGER_REPORT_CATALOG_ENTRY,
  REPORT_DEFINITIONS,
  REPORT_GROUPS,
  REPORT_GROUP_LABELS,
  REPORT_GROUP_PERMISSION,
  reportPermissions,
  reportsForGroup,
  type ReportDefinition,
} from '@hospai/contracts';
import {
  Alert,
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
  PageHeader,
  Skeleton,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';

/**
 * Reports catalogue (R4.14): the named operational reports, grouped, showing only the reports whose
 * permissions (the group's data permission, plus any extra a report names) the user holds. A group
 * with nothing to show is not listed.
 */
export function ReportsCatalogScreen() {
  const { subtitle } = usePropertySubtitle('Operational reports');
  const meQ = useQuery({
    queryKey: ['me', tenant.propertyId],
    queryFn: () => api.getMe(tenant.propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const me = meQ.data as PropertyMe | undefined;
  // Fail open while authority is unknown, as the nav does; the route's own read still enforces it.
  const unknownAuthority = meQ.isError && asClassified(meQ.error).class !== 'unauthorized';
  const allowed = (d: ReportDefinition) =>
    unknownAuthority ||
    (me !== undefined && reportPermissions(d).every((p) => hasPropertyPermission(me, p)));
  // The Manager Report (R4.32) has its own screen; it sits in the Night audit group and needs that group's permission.
  const managerAllowed =
    unknownAuthority || (me !== undefined && hasPropertyPermission(me, REPORT_GROUP_PERMISSION.night_audit));
  const groups = REPORT_GROUPS.filter(
    (g) =>
      REPORT_DEFINITIONS.some((d) => d.group === g && allowed(d)) || (g === 'night_audit' && managerAllowed),
  );

  let body;
  if (meQ.isPending) {
    body = (
      <Card>
        <CardContent>
          <Skeleton />
        </CardContent>
      </Card>
    );
  } else if (meQ.isError && !unknownAuthority) {
    body = (
      <Card>
        <CardContent>
          <Alert data-testid="reports-error">Could not check your access to reports.</Alert>
        </CardContent>
      </Card>
    );
  } else if (groups.length === 0) {
    body = (
      <Card>
        <CardContent>
          <EmptyState
            data-testid="reports-none"
            title="No reports for your role"
            description="Ask a manager for access to the data behind a report."
          />
        </CardContent>
      </Card>
    );
  } else {
    body = groups.map((g) => (
      <Card key={g} data-testid={`reports-group-${g}`}>
        <CardHeader>
          <CardTitle>{REPORT_GROUP_LABELS[g]}</CardTitle>
        </CardHeader>
        <CardContent flush>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Report</DataTableHeaderCell>
                <DataTableHeaderCell>What it shows</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {g === 'night_audit' && managerAllowed ? (
                <DataTableRow>
                  <DataTableCell>
                    <Link to={MANAGER_REPORT_CATALOG_ENTRY.path} data-testid="report-link-manager_report">
                      {MANAGER_REPORT_CATALOG_ENTRY.title}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>
                    <span className="muted">{MANAGER_REPORT_CATALOG_ENTRY.description}</span>
                    <VisuallyHidden> Opens the {MANAGER_REPORT_CATALOG_ENTRY.title}.</VisuallyHidden>
                  </DataTableCell>
                </DataTableRow>
              ) : null}
              {reportsForGroup(g).filter(allowed).map((d) => (
                <DataTableRow key={d.id}>
                  <DataTableCell>
                    <Link to={`/reports/${encodeURIComponent(d.id)}`} data-testid={`report-link-${d.id}`}>
                      {d.title}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>
                    <span className="muted">{d.description}</span>
                    <VisuallyHidden> Opens the {d.title} report.</VisuallyHidden>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </CardContent>
      </Card>
    ));
  }

  return (
    <div className="board-page">
      <PageHeader title="Reports" subtitle={subtitle} />
      {body}
    </div>
  );
}
