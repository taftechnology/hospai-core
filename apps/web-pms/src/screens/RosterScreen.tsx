import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
    <section data-testid="roster-screen" className="panel">
      <h1>Roster</h1>
      {staff.length === 0 && listQuery.isSuccess && <p>Add someone to the roster</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (displayName.trim()) addMutation.mutate();
        }}
      >
        <label>
          Name{' '}
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoComplete="off"
          />
        </label>
        <label>
          Email{' '}
          <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Phone{' '}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
        </label>
        {canCompensation && (
          <>
            <label>
              Hourly rate{' '}
              <input
                type="number"
                value={hourlyRateMinor}
                onChange={(e) => setHourlyRateMinor(e.target.value)}
              />
            </label>
            <label>
              Currency{' '}
              <input
                value={hourlyRateCurrency}
                onChange={(e) => setHourlyRateCurrency(e.target.value)}
              />
            </label>
            <label>
              Rating{' '}
              <input type="number" value={rating} onChange={(e) => setRating(e.target.value)} />
            </label>
            <label>
              Skills{' '}
              <input value={skills} onChange={(e) => setSkills(e.target.value)} />
            </label>
          </>
        )}
        <button type="submit">Add</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {staff.map((row) => {
            const label = row.displayName ?? row.staffId;
            const exited = row.exitedAt != null;
            return (
              <tr key={row.staffId}>
                <td>{label}</td>
                <td>
                  {exited ? (
                    'exited'
                  ) : (
                    <select
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
                    </select>
                  )}
                </td>
                <td>
                  {exited ? null : (
                    <button type="button" onClick={() => onExit(row)}>
                      Exit {label}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
