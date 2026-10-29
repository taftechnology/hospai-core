import { ClassifiedError } from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
  Field,
  Input,
  NativeSelect,
  PageHeader,
} from '@hospai/ui-kit';
import {
  hasOrgPermission,
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';

type OrgRole = 'owner' | 'admin' | 'staff';
type PropertyWriteRole = 'admin' | 'staff';

type DirectoryMember = {
  userId: string;
  role: OrgRole;
  createdAt: number;
  updatedAt: number | null;
  displayName: string | null;
  email: string | null;
};

type PropertyMember = DirectoryMember & { hasOrgRole: boolean };

const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'staff'];
const PROPERTY_ROLES: PropertyWriteRole[] = ['admin', 'staff'];

const SELF_DEMOTE_COPY =
  "You'll lose access to staff management. Only another owner can restore your role.";
const SELF_ORG_DELETE_COPY =
  "You'll lose all access to this organization and every property. Only another owner can restore you.";
const ORG_DELETE_CASCADE_COPY =
  'Remove this person from the company and all property roles?';

function memberLabel(m: { displayName: string | null; email: string | null; userId: string }) {
  if (m.displayName) return m.displayName;
  if (m.email) return m.email;
  return m.userId;
}

function isDangling(
  m: { displayName: string | null; email: string | null },
  directoryUnavailable: boolean,
): boolean {
  return !directoryUnavailable && m.displayName === null && m.email === null;
}

function errorBody(err: unknown): Record<string, unknown> | null {
  if (!(err instanceof ClassifiedError)) return null;
  const b = err.classified.body;
  return b !== null && typeof b === 'object' ? (b as Record<string, unknown>) : null;
}

function membershipWriteMessage(err: unknown): string {
  const c = asClassified(err);
  const body = errorBody(err);
  const code = typeof body?.error === 'string' ? body.error : null;

  if (c.status === 409 && code === 'already_member') {
    const role = typeof body?.role === 'string' ? body.role : 'member';
    return `Already a member (${role}). Change their role instead`;
  }
  if (c.status === 422 && code === 'no_such_user') {
    return 'No Hospai account for that email yet. Ask them to sign up, then add them here.';
  }
  if (c.status === 422 && code === 'email_ambiguous') {
    return 'That email matches more than one account. Contact support.';
  }
  if (c.status === 422 && code === 'role_escalation') {
    return 'You cannot grant a role at or above your own.';
  }
  if (c.status === 422 && code === 'last_owner') {
    return 'Cannot remove or demote the last owner.';
  }
  if (c.status === 422 && code === 'invalid_role') {
    return 'That role is not allowed here.';
  }
  if (c.class === 'fail_closed' && code === 'clerk_unreachable') {
    return 'Directory unavailable — try again shortly.';
  }
  if (c.class === 'fail_closed') {
    return 'Organization unavailable — try again shortly.';
  }
  return classifiedUserMessage(c, { fallback: 'Request failed.' });
}

export function StaffScreen() {
  const propertyId = tenant.propertyId;
  const orgId = tenant.orgId;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [focusUserId, setFocusUserId] = useState<string | null>(null);
  const [propEmail, setPropEmail] = useState('');
  const [propRole, setPropRole] = useState<PropertyWriteRole>('staff');
  const [orgEmail, setOrgEmail] = useState('');
  const [orgRole, setOrgRole] = useState<OrgRole>('staff');
  const [pendingRemove, setPendingRemove] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const meQuery = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });

  const shell = meShellStateFromQuery({
    status: meQuery.status,
    data: meQuery.data as PropertyMe | undefined,
    classified: meQuery.isError ? asClassified(meQuery.error) : undefined,
  });

  const me =
    shell.kind === 'authority' && shell.authority.kind === 'live'
      ? shell.authority.me
      : null;

  const canWriteStaff = me ? hasPropertyPermission(me, 'staff:write') : false;
  const canManageOrg = me ? hasOrgPermission(me, 'org:manage') : false;

  const propertyMembersQ = useQuery({
    queryKey: ['property-members', propertyId],
    queryFn: () => api.listPropertyMembers(propertyId),
    staleTime: 60_000,
    enabled: Boolean(me),
  });

  const orgMembersQ = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: () => api.listOrgMembers(orgId),
    staleTime: 60_000,
    enabled: Boolean(me) && canManageOrg,
  });

  const { subtitle } = usePropertySubtitle('Team members');

  useEffect(() => {
    if (!focusUserId) return;
    const el = rowRefs.current.get(focusUserId);
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: 'nearest' });
    }
  }, [focusUserId, propertyMembersQ.data, orgMembersQ.data]);

  async function invalidateLists(targetUserId?: string) {
    const tasks = [
      queryClient.invalidateQueries({ queryKey: ['property-members', propertyId] }),
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] }),
    ];
    if (targetUserId && me && targetUserId === me.userId) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ['me', propertyId] }));
    }
    await Promise.all(tasks);
  }

  const addPropertyMut = useMutation({
    mutationFn: () =>
      api.createPropertyMember(propertyId, { email: propEmail.trim(), role: propRole }),
    onSuccess: async () => {
      setPropEmail('');
      setMessage('Added to property.');
      await invalidateLists();
    },
    onError: (err) => {
      const body = errorBody(err);
      if (
        err instanceof ClassifiedError &&
        err.classified.status === 409 &&
        body?.error === 'already_member' &&
        typeof body.userId === 'string'
      ) {
        setFocusUserId(body.userId);
      }
      setMessage(membershipWriteMessage(err));
    },
  });

  const addOrgMut = useMutation({
    mutationFn: () => api.createOrgMember(orgId, { email: orgEmail.trim(), role: orgRole }),
    onSuccess: async () => {
      setOrgEmail('');
      setMessage('Added to organization.');
      await invalidateLists();
    },
    onError: (err) => {
      const body = errorBody(err);
      if (
        err instanceof ClassifiedError &&
        err.classified.status === 409 &&
        body?.error === 'already_member' &&
        typeof body.userId === 'string'
      ) {
        setFocusUserId(body.userId);
      }
      setMessage(membershipWriteMessage(err));
    },
  });

  async function updatePropertyRole(userId: string, role: PropertyWriteRole) {
    if (!me) return;
    if (userId === me.userId && !window.confirm(SELF_DEMOTE_COPY)) return;
    try {
      await api.updatePropertyMember(propertyId, userId, { role });
      setMessage('Role updated.');
      await invalidateLists(userId);
    } catch (err) {
      setMessage(membershipWriteMessage(err));
    }
  }

  async function updateOrgRole(userId: string, role: OrgRole) {
    if (!me) return;
    if (userId === me.userId && !window.confirm(SELF_DEMOTE_COPY)) return;
    try {
      await api.updateOrgMember(orgId, userId, { role });
      setMessage('Role updated.');
      await invalidateLists(userId);
    } catch (err) {
      setMessage(membershipWriteMessage(err));
    }
  }

  function requestRemoveProperty(m: PropertyMember) {
    if (!me) return;
    const self = m.userId === me.userId;
    let description = 'Remove this member from the property?';
    if (self) {
      description = m.hasOrgRole
        ? 'Remove your property override? Your company role will still apply here.'
        : 'Remove yourself from this property? You will lose access here.';
    } else if (m.hasOrgRole) {
      description = 'Remove their property override? Their company role will still apply here.';
    }
    setPendingRemove({
      title: 'Remove from property?',
      description,
      run: async () => {
        try {
          await api.deletePropertyMember(propertyId, m.userId);
          setMessage('Removed from property.');
          await invalidateLists(m.userId);
        } catch (err) {
          setMessage(membershipWriteMessage(err));
        }
      },
    });
  }

  function requestRemoveOrg(userId: string) {
    if (!me) return;
    const self = userId === me.userId;
    setPendingRemove({
      title: 'Remove from organization?',
      description: self ? SELF_ORG_DELETE_COPY : ORG_DELETE_CASCADE_COPY,
      run: async () => {
        try {
          await api.deleteOrgMember(orgId, userId);
          setMessage(self ? null : 'Removed from organization.');
          await invalidateLists(userId);
        } catch (err) {
          setMessage(membershipWriteMessage(err));
        }
      },
    });
  }

  if (!me) {
    return (
      <section data-testid="staff-screen">
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const propDirectoryUnavailable = propertyMembersQ.data?.directory === 'unavailable';
  const orgDirectoryUnavailable = orgMembersQ.data?.directory === 'unavailable';

  return (
    <div className="ui-page-stack staff-screen">
      <PageHeader title="Staff" subtitle={subtitle} />
      <div className="ui-page-stack" data-testid="staff-screen">
        {message ? (
          <Alert data-testid="staff-message">{message}</Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Property</CardTitle>
          </CardHeader>

          {propDirectoryUnavailable ? (
            <CardContent>
              <p className="muted" data-testid="property-directory-unavailable">
                Names unavailable
              </p>
            </CardContent>
          ) : null}

          {canWriteStaff ? (
            <CardContent>
              <form
                className="staff__form"
                data-testid="property-add-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  addPropertyMut.mutate();
                }}
              >
                <Field
                  label="Property member email"
                  control={
                    <Input
                      type="email"
                      required
                      placeholder="Email"
                      value={propEmail}
                      onChange={(e) => setPropEmail(e.target.value)}
                      aria-label="Property member email"
                    />
                  }
                />
                <Field
                  label="Property member role"
                  control={
                    <NativeSelect
                      value={propRole}
                      onChange={(e) => setPropRole(e.target.value as PropertyWriteRole)}
                      aria-label="Property member role"
                    >
                      {PROPERTY_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </NativeSelect>
                  }
                />
                <Button type="submit" intent="primary" disabled={addPropertyMut.isPending}>
                  Add
                </Button>
              </form>
            </CardContent>
          ) : null}

          {propertyMembersQ.isPending ? (
            <CardContent>
              <p className="muted">Loading…</p>
            </CardContent>
          ) : propertyMembersQ.isError ? (
            <CardContent>
              <Alert>Could not load property members</Alert>
            </CardContent>
          ) : null}
          {(propertyMembersQ.data?.members ?? []).length > 0 ? (
            <CardContent flush>
              <div className="staff__table" data-testid="property-roster">
                <DataTable>
                  <DataTableHead>
                    <DataTableRow>
                      <DataTableHeaderCell align="left">Name</DataTableHeaderCell>
                      <DataTableHeaderCell align="left">Role</DataTableHeaderCell>
                      <DataTableHeaderCell align="left" />
                    </DataTableRow>
                  </DataTableHead>
                  <DataTableBody>
                    {(propertyMembersQ.data?.members ?? []).map((m) => {
                      const dangling = isDangling(m, propDirectoryUnavailable);
                      return (
                        <DataTableRow
                          key={m.userId}
                          data-testid={`property-member-${m.userId}`}
                          data-focused={focusUserId === m.userId ? 'true' : undefined}
                          tabIndex={-1}
                          ref={(el) => {
                            if (el) rowRefs.current.set(m.userId, el);
                            else rowRefs.current.delete(m.userId);
                          }}
                        >
                          <DataTableCell align="left">
                            <strong>{memberLabel(m)}</strong>
                            <span className="muted"> {m.userId}</span>
                            {dangling ? (
                              <span className="error" data-testid={`dangling-${m.userId}`}>
                                {' '}
                                Account no longer exists
                              </span>
                            ) : null}
                          </DataTableCell>
                          <DataTableCell align="left">
                            {canWriteStaff ? (
                              (PROPERTY_ROLES as readonly string[]).includes(m.role) ? (
                                <NativeSelect
                                  aria-label={`Role for ${m.userId}`}
                                  value={m.role}
                                  onChange={(e) =>
                                    void updatePropertyRole(m.userId, e.target.value as PropertyWriteRole)
                                  }
                                >
                                  {PROPERTY_ROLES.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </NativeSelect>
                              ) : (
                                <span className="muted" data-testid={`property-role-readonly-${m.userId}`}>
                                  {m.role}
                                </span>
                              )
                            ) : null}
                          </DataTableCell>
                          <DataTableCell align="left">
                            {canWriteStaff ? (
                              <Button type="button" onClick={() => requestRemoveProperty(m)}>
                                Remove
                              </Button>
                            ) : null}
                          </DataTableCell>
                        </DataTableRow>
                      );
                    })}
                  </DataTableBody>
                </DataTable>
              </div>
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Org membership</CardTitle>
          </CardHeader>

          {!canManageOrg ? (
            <CardContent>
              <p data-testid="org-section-disabled">
                Org membership — Requires <code>org:manage</code>. Ask an owner.
              </p>
            </CardContent>
          ) : (
            <>
              <CardContent>
                {orgDirectoryUnavailable ? (
                  <p className="muted" data-testid="org-directory-unavailable">
                    Names unavailable
                  </p>
                ) : null}

                <form
                  className="staff__form"
                  data-testid="org-add-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addOrgMut.mutate();
                  }}
                >
                  <Field
                    label="Org member email"
                    control={
                      <Input
                        type="email"
                        required
                        placeholder="Email"
                        value={orgEmail}
                        onChange={(e) => setOrgEmail(e.target.value)}
                        aria-label="Org member email"
                      />
                    }
                  />
                  <Field
                    label="Org member role"
                    control={
                      <NativeSelect
                        value={orgRole}
                        onChange={(e) => setOrgRole(e.target.value as OrgRole)}
                        aria-label="Org member role"
                      >
                        {ORG_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </NativeSelect>
                    }
                  />
                  <Button type="submit" disabled={addOrgMut.isPending}>
                    Add
                  </Button>
                </form>
              </CardContent>

              {orgMembersQ.isPending ? (
                <CardContent>
                  <p className="muted">Loading…</p>
                </CardContent>
              ) : orgMembersQ.isError ? (
                <CardContent>
                  <Alert>Could not load org members</Alert>
                </CardContent>
              ) : null}
              {(orgMembersQ.data?.members ?? []).length > 0 ? (
                <CardContent flush>
                  <div className="staff__table" data-testid="org-roster">
                    <DataTable>
                      <DataTableHead>
                        <DataTableRow>
                          <DataTableHeaderCell align="left">Name</DataTableHeaderCell>
                          <DataTableHeaderCell align="left">Role</DataTableHeaderCell>
                          <DataTableHeaderCell align="left" />
                        </DataTableRow>
                      </DataTableHead>
                      <DataTableBody>
                        {(orgMembersQ.data?.members ?? []).map((m) => {
                          const dangling = isDangling(m, orgDirectoryUnavailable);
                          return (
                            <DataTableRow
                              key={m.userId}
                              data-testid={`org-member-${m.userId}`}
                              data-focused={focusUserId === m.userId ? 'true' : undefined}
                              tabIndex={-1}
                              ref={(el) => {
                                if (el) rowRefs.current.set(m.userId, el);
                                else rowRefs.current.delete(m.userId);
                              }}
                            >
                              <DataTableCell align="left">
                                <strong>{memberLabel(m)}</strong>
                                <span className="muted"> {m.userId}</span>
                                {dangling ? (
                                  <span className="error" data-testid={`dangling-${m.userId}`}>
                                    {' '}
                                    Account no longer exists
                                  </span>
                                ) : null}
                              </DataTableCell>
                              <DataTableCell align="left">
                                <NativeSelect
                                  aria-label={`Org role for ${m.userId}`}
                                  value={m.role}
                                  onChange={(e) =>
                                    void updateOrgRole(m.userId, e.target.value as OrgRole)
                                  }
                                >
                                  {ORG_ROLES.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </DataTableCell>
                              <DataTableCell align="left">
                                <Button type="button" onClick={() => requestRemoveOrg(m.userId)}>
                                  Remove
                                </Button>
                              </DataTableCell>
                            </DataTableRow>
                          );
                        })}
                      </DataTableBody>
                    </DataTable>
                  </div>
                </CardContent>
              ) : null}
            </>
          )}
        </Card>
      </div>
      {pendingRemove ? (
        <ConfirmDialog
          title={pendingRemove.title}
          description={pendingRemove.description}
          confirmLabel="Remove"
          intent="destructive"
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            const job = pendingRemove;
            setPendingRemove(null);
            void job.run();
          }}
        />
      ) : null}
    </div>
  );
}