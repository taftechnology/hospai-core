import { useParams } from 'react-router';
import { REPORT_GROUP_PERMISSION, reportDefinition } from '@hospai/contracts';
import { PermissionRoute } from '../auth/PermissionRoute.js';

/**
 * Gate for `/reports/:reportId`: the permission is the one for the report's data group. A miss
 * flashes the permission toast and returns to the catalogue; an unknown id falls through to the
 * runner's own "no such report" state.
 */
export function ReportRunnerGate() {
  const { reportId = '' } = useParams();
  const def = reportDefinition(reportId);
  if (!def) return <PermissionRoute permission="property:read" fallback="/reports" />;
  return <PermissionRoute permission={REPORT_GROUP_PERMISSION[def.group]} fallback="/reports" />;
}
