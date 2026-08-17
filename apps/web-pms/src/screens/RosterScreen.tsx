import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
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
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';

export const ROSTER_EXIT_CONFIRM =
  'The name and contact will be removed. The employment record is kept. This cannot be undone.';

type RosterRow = {
  staffId: string;
  kinds: string[];
  status: string;
  exitedAt: number | null;
  displayName?: string;
  email?: string;
  phone?: string;
};

export function RosterScreen() {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [hourlyRateMinor, setHourlyRateMinor] = useState('');
  const [hourlyRateCurrency, setHourlyRateCurrency] = useState('USD');
  const [rating, setRating] = useState('');
  const [skills, setSkills] = useState('');

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
  const me = shell.kind === 'authority' && shell.authority.kind === 'live' ? shell.authority.me : undefined;
  const canCompensation = Boolean(me && hasPropertyPermission(me, 'roster:compensation'));

  const listQuery = useQuery({
    queryKey: ['roster', propertyId],
    queryFn: () => api.listRoster(propertyId),
  });

  const staff: RosterRow[] = listQuery.data?.staff ?? [];

  const addMutation = useMutation({
    mutationFn: () => {
      const input: {
        displayName: string;
        kinds: string[];
        email?: string;
        phone?: string;
        hourlyRate?: { amountMinor: number; currency: string };
        rating?: number;
        skills?: string[];
      } = {
        displayName: displayName.trim(),
        kinds: ['housekeeper'],
      };
      if (email.trim()) input.email = email.trim();
      if (phone.trim()) input.phone = phone.trim();
      if (canCompensation && hourlyRateMinor !== '') {
        input.hourlyRate = {
          amountMinor: Number(hourlyRateMinor),
          currency: hourlyRateCurrency,
        };
      }
      if (canCompensation && rating !== '') input.rating = Number(rating);
      if (canCompensation && skills.trim()) {
        input.skills = skills.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return api.addRoster(propertyId, input, `roster-add:${displayName.trim()}`);
    },
    onSuccess: async () => {
      setDisplayName('');
      setEmail('');
      setPhone('');
      setHourlyRateMinor('');
      setRating('');
      setSkills('');
      await queryClient.invalidateQueries({ queryKey: ['roster', propertyId] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (input: { staffId: string; status: 'active' | 'inactive' }) =>
      api.setRosterStatus(propertyId, input.staffId, input.status, `roster-status:${input.staffId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roster', propertyId] });
    },
  });

  const exitMutation = useMutation({
    mutationFn: (staffId: string) => api.exitRoster(propertyId, staffId, `roster-exit:${staffId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roster', propertyId] });
    },
  });

  function onExit(row: RosterRow) {
    if (!window.confirm(ROSTER_EXIT_CONFIRM)) return;
    exitMutation.mutate(row.staffId);
  }

  return (
    <div className="ui-page-stack roster-screen">
      <PageHeader title="Roster" subtitle="Scheduled staff · The Meridian Seattle" />
      <Card data-testid="roster-screen" className="roster-screen__shell">
        <Card>
          <CardHeader>
            <CardTitle>Add staff</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="roster__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (displayName.trim()) addMutation.mutate();
              }}
            >
              <Field
                label="Name"
                control={
                  <Input
                    placeholder="Maya Chen"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    autoComplete="off"
                  />
                }
              />
              <Field
                label="Email"
                control={
                  <Input
                    placeholder="maya.chen@meridian.example"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
              <Field
                label="Phone"
                control={
                  <Input
                    placeholder="+1 206 555 0100"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
              {canCompensation && (
                <>
                  <Field
                    label="Hourly rate"
                    control={
                      <Input
                        type="number"
                        placeholder="2000"
                        value={hourlyRateMinor}
                        onChange={(e) => setHourlyRateMinor(e.target.value)}
                      />
                    }
                  />
                  <Field
                    label="Currency"
                    control={
                      <Input
                        placeholder="USD"
                        value={hourlyRateCurrency}
                        onChange={(e) => setHourlyRateCurrency(e.target.value)}
                      />
                    }
                  />
                  <Field
                    label="Rating"
                    control={
                      <Input
                        type="number"
                        placeholder="4"
                        value={rating}
                        onChange={(e) => setRating(e.target.value)}
                      />
                    }
                  />
                  <Field
                    label="Skills"
                    control={
                      <Input
                        placeholder="beds, bathrooms"
                        value={skills}
                        onChange={(e) => setSkills(e.target.value)}
                      />
                    }
                  />
                </>
              )}
              <Button type="submit" intent="primary">
                Add
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Roster</CardTitle>
          </CardHeader>
          {staff.length === 0 && listQuery.isSuccess ? (
            <CardContent>
              <p>Add someone to the roster</p>
            </CardContent>
          ) : (
            <CardContent flush>
              <div className="roster__table">
                <DataTable>
                  <DataTableHead>
                    <DataTableRow>
                      <DataTableHeaderCell>Name</DataTableHeaderCell>
                      <DataTableHeaderCell>Status</DataTableHeaderCell>
                      <DataTableHeaderCell />
                    </DataTableRow>
                  </DataTableHead>
                  <DataTableBody>
                    {staff.map((row) => {
                      const label = row.displayName ?? row.staffId;
                      const exited = row.exitedAt != null;
                      return (
                        <DataTableRow key={row.staffId}>
                          <DataTableCell>{label}</DataTableCell>
                          <DataTableCell>
                            {exited ? (
                              'exited'
                            ) : (
                              <NativeSelect
                                aria-label={`Status for ${label}`}
                                value={row.status}
                                onChange={(e) => {
                                  const status = e.target.value as 'active' | 'inactive';
                                  if (status !== row.status) {
                                    statusMutation.mutate({ staffId: row.staffId, status });
                                  }
                                }}
                              >
                                <option value="active">active</option>
                                <option value="inactive">inactive</option>
                              </NativeSelect>
                            )}
                          </DataTableCell>
                          <DataTableCell>
                            {exited ? null : (
                              <Button type="button" intent="destructive" onClick={() => onExit(row)}>
                                Exit {label}
                              </Button>
                            )}
                          </DataTableCell>
                        </DataTableRow>
                      );
                    })}
                  </DataTableBody>
                </DataTable>
              </div>
            </CardContent>
          )}
        </Card>
      </Card>
    </div>
  );
}