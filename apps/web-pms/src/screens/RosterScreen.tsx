import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  RowActions,
} from '@hospai/ui-kit';
import {
  ROSTER_OPS_SKILL_LENGTH_MAX,
  ROSTER_OPS_SKILLS_MAX,
  normalizeRosterOpsSkills,
  type RosterShift,
} from '@hospai/contracts';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { FormDialog } from '../shell/FormDialog.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';

export const ROSTER_EXIT_CONFIRM =
  'The name and contact will be removed. The employment record is kept. This cannot be undone.';

const WRITE_REASON = 'Roster write is required to change kinds and work at this hotel.';
const ADD_KIND_REASON = 'Select at least one kind.';
const EDIT_KIND_REASON = 'Pick at least one kind.';
const MAX_ROOMS_REASON = 'Max rooms must be a whole number from 1 to 50, or empty.';
const UNSET = '—';

const KIND_OPTIONS = [
  { id: 'housekeeper', label: 'Housekeeper' },
  { id: 'maintenance', label: 'Maintenance' },
] as const;

const SHIFT_OPTIONS: Array<{ value: '' | RosterShift; label: string }> = [
  { value: '', label: 'Not set' },
  { value: 'morning', label: 'Morning' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
  { value: 'any', label: 'Any' },
];

type RosterOps = {
  shift: RosterShift | null;
  maxRooms: number | null;
  skills: string[];
};

type RosterRow = {
  staffId: string;
  kinds: string[];
  status: string;
  exitedAt: number | null;
  displayName?: string;
  email?: string;
  phone?: string;
  ops?: RosterOps;
};

function orderedKinds(selected: readonly string[]): string[] {
  return KIND_OPTIONS.map((kind) => kind.id).filter((id) => selected.includes(id));
}

function kindWords(kinds: readonly string[]): string {
  const words = orderedKinds(kinds).map(
    (id) => KIND_OPTIONS.find((kind) => kind.id === id)?.label ?? id,
  );
  return words.join(' · ');
}

function toggleKind(selected: readonly string[], id: string, on: boolean): string[] {
  if (on) return selected.includes(id) ? [...selected] : [...selected, id];
  return selected.filter((kind) => kind !== id);
}

function parseMaxRooms(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  if (value < 1 || value > 50) return 'invalid';
  return value;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function shiftWord(shift: RosterShift | null | undefined): string {
  if (!shift) return UNSET;
  return SHIFT_OPTIONS.find((option) => option.value === shift)?.label ?? UNSET;
}

function invalidateRoster(queryClient: ReturnType<typeof useQueryClient>, propertyId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['roster', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['roster', propertyId, 'housekeeper'] }),
  ]);
}

function rosterSkillTooLong(skills: readonly string[]): boolean {
  return skills.some((skill) => skill.length > ROSTER_OPS_SKILL_LENGTH_MAX);
}

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
  const [addKinds, setAddKinds] = useState<string[]>(['housekeeper']);
  const [exitTarget, setExitTarget] = useState<RosterRow | null>(null);
  const [editTarget, setEditTarget] = useState<RosterRow | null>(null);

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
  const canWrite = Boolean(me && hasPropertyPermission(me, 'roster:write'));

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
        kinds: orderedKinds(addKinds),
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
      setAddKinds(['housekeeper']);
      await invalidateRoster(queryClient, propertyId);
    },
  });

  const statusMutation = useMutation({
    mutationFn: (input: { staffId: string; status: 'active' | 'inactive' }) =>
      api.setRosterStatus(propertyId, input.staffId, input.status, `roster-status:${input.staffId}`),
    onSuccess: async () => {
      await invalidateRoster(queryClient, propertyId);
    },
  });

  const exitMutation = useMutation({
    mutationFn: (staffId: string) => api.exitRoster(propertyId, staffId, `roster-exit:${staffId}`),
    onSuccess: async () => {
      await invalidateRoster(queryClient, propertyId);
    },
  });

  const { subtitle } = usePropertySubtitle('Scheduled staff');
  const addBlocked = !canWrite || addKinds.length === 0;

  return (
    <div className="ui-page-stack roster-screen">
      <PageHeader title="Roster" subtitle={subtitle} />
      <div className="ui-page-stack" data-testid="roster-screen">
        <Card>
          <CardHeader>
            <CardTitle>Add staff</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="roster__form"
              data-testid="roster-add-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (displayName.trim() && !addBlocked) addMutation.mutate();
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
              <KindGroup
                selected={addKinds}
                disabled={!canWrite}
                emptyReason={canWrite && addKinds.length === 0 ? ADD_KIND_REASON : null}
                writeReason={canWrite ? null : WRITE_REASON}
                onChange={setAddKinds}
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
              <Button type="submit" intent="primary" disabled={addBlocked}>
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
              <EmptyState title="Add someone to the roster" />
            </CardContent>
          ) : (
            <CardContent flush>
              <div className="roster__table">
                <DataTable>
                  <DataTableHead>
                    <DataTableRow>
                      <DataTableHeaderCell>Name</DataTableHeaderCell>
                      <DataTableHeaderCell>Kinds</DataTableHeaderCell>
                      <DataTableHeaderCell>Shift</DataTableHeaderCell>
                      <DataTableHeaderCell>Max rooms</DataTableHeaderCell>
                      <DataTableHeaderCell>Status</DataTableHeaderCell>
                      <DataTableHeaderCell />
                    </DataTableRow>
                  </DataTableHead>
                  <DataTableBody>
                    {staff.map((row) => {
                      const label = row.displayName ?? row.staffId;
                      const exited = row.exitedAt != null;
                      const shownSkills = (row.ops?.skills ?? []).slice(0, 3);
                      const extraSkills = (row.ops?.skills ?? []).length - shownSkills.length;
                      return (
                        <DataTableRow key={row.staffId}>
                          <DataTableCell>
                            <div className="roster__name">
                              <span>{label}</span>
                              {shownSkills.length > 0 ? (
                                <span className="roster__skills">
                                  {shownSkills.map((skill) => (
                                    <Badge key={skill} rung="informational">
                                      {skill}
                                    </Badge>
                                  ))}
                                  {extraSkills > 0 ? (
                                    <Badge rung="informational">{`+${extraSkills}`}</Badge>
                                  ) : null}
                                </span>
                              ) : null}
                            </div>
                          </DataTableCell>
                          <DataTableCell>{kindWords(row.kinds)}</DataTableCell>
                          <DataTableCell>{shiftWord(row.ops?.shift)}</DataTableCell>
                          <DataTableCell>
                            {row.ops?.maxRooms != null ? row.ops.maxRooms : UNSET}
                          </DataTableCell>
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
                              <RowActions>
                                {canWrite ? (
                                  <Button
                                    type="button"
                                    intent="ghost"
                                    aria-label={`Edit ${label}`}
                                    onClick={() => setEditTarget(row)}
                                  >
                                    Edit
                                  </Button>
                                ) : null}
                                <Button type="button" onClick={() => setExitTarget(row)}>
                                  Exit {label}
                                </Button>
                              </RowActions>
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
      </div>
      {editTarget ? (
        <EditStaffDialog
          row={editTarget}
          propertyId={propertyId}
          onClose={() => setEditTarget(null)}
        />
      ) : null}
      {exitTarget ? (
        <ConfirmDialog
          title={`Exit ${exitTarget.displayName ?? exitTarget.staffId}?`}
          description={ROSTER_EXIT_CONFIRM}
          confirmLabel="Exit"
          intent="destructive"
          onCancel={() => setExitTarget(null)}
          onConfirm={() => {
            exitMutation.mutate(exitTarget.staffId);
            setExitTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function KindGroup({
  selected,
  disabled,
  emptyReason,
  writeReason,
  onChange,
}: {
  selected: readonly string[];
  disabled: boolean;
  emptyReason: string | null;
  writeReason: string | null;
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="ui-field-group roster__kinds">
      <legend className="ui-field-group__legend">Works as</legend>
      <div className="ui-choice-row">
        {KIND_OPTIONS.map((kind) => (
          <label key={kind.id} className="ui-choice">
            <Checkbox
              aria-label={kind.label}
              checked={selected.includes(kind.id)}
              disabled={disabled}
              onChange={(e) => onChange(toggleKind(selected, kind.id, e.target.checked))}
            />
            {kind.label}
          </label>
        ))}
      </div>
      {writeReason ? <p className="muted">{writeReason}</p> : null}
      {emptyReason ? <p className="muted">{emptyReason}</p> : null}
    </fieldset>
  );
}

function EditStaffDialog({
  row,
  propertyId,
  onClose,
}: {
  row: RosterRow;
  propertyId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const label = row.displayName ?? row.staffId;
  const [kinds, setKinds] = useState<string[]>(row.kinds);
  const [shift, setShift] = useState<'' | RosterShift>(row.ops?.shift ?? '');
  const [maxRooms, setMaxRooms] = useState(row.ops?.maxRooms != null ? String(row.ops.maxRooms) : '');
  const [skillTags, setSkillTags] = useState<string[]>(row.ops?.skills ?? []);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsedMax = parseMaxRooms(maxRooms);
  const atSkillCap = skillTags.length >= ROSTER_OPS_SKILLS_MAX;
  const saveDisabled = kinds.length === 0 || parsedMax === 'invalid' || saving;

  function addSkill() {
    if (atSkillCap) return;
    const next = normalizeRosterOpsSkills([...skillTags, draft]);
    if (rosterSkillTooLong(next)) return;
    setSkillTags(next);
    setDraft('');
  }

  async function save() {
    if (saveDisabled) return;
    const nextKinds = orderedKinds(kinds);
    const kindsChanged = !sameList(nextKinds, orderedKinds(row.kinds));
    const nextOps = {
      shift: shift === '' ? null : shift,
      maxRooms: parsedMax,
      skills: skillTags,
    };
    const prevOps = {
      shift: row.ops?.shift ?? null,
      maxRooms: row.ops?.maxRooms ?? null,
      skills: row.ops?.skills ?? [],
    };
    const opsChanged =
      nextOps.shift !== prevOps.shift ||
      nextOps.maxRooms !== prevOps.maxRooms ||
      !sameList(nextOps.skills, prevOps.skills);

    if (!kindsChanged && !opsChanged) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    let savedAny = false;
    try {
      if (kindsChanged) {
        await api.updateRoster(propertyId, row.staffId, { kinds: nextKinds }, crypto.randomUUID());
        savedAny = true;
      }
      if (opsChanged) {
        await api.setRosterOps(propertyId, row.staffId, nextOps, crypto.randomUUID());
      }
      await invalidateRoster(queryClient, propertyId);
      onClose();
    } catch (err) {
      if (savedAny) await invalidateRoster(queryClient, propertyId);
      setError(classifiedUserMessage(asClassified(err), { fallback: 'Could not save this edit.' }));
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={`Edit — ${label}`}
      onClose={onClose}
      actions={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" intent="primary" disabled={saveDisabled} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <KindGroup
        selected={kinds}
        disabled={false}
        emptyReason={kinds.length === 0 ? EDIT_KIND_REASON : null}
        writeReason={null}
        onChange={setKinds}
      />
      <fieldset className="ui-field-group">
        <legend className="ui-field-group__legend">Work at this hotel</legend>
        <Field
          label="Shift"
          control={
            <NativeSelect
              value={shift}
              onChange={(e) => setShift(e.target.value as '' | RosterShift)}
            >
              {SHIFT_OPTIONS.map((option) => (
                <option key={option.value || 'unset'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          }
        />
        <Field
          label="Max rooms"
          hint="1–50, empty if not set"
          error={parsedMax === 'invalid' ? MAX_ROOMS_REASON : undefined}
          control={
            <Input
              type="number"
              min={1}
              max={50}
              value={maxRooms}
              onChange={(e) => setMaxRooms(e.target.value)}
            />
          }
        />
        <div className="guest-tag-list">
          {skillTags.length > 0 ? (
            <div className="guest-preferences-badges">
              {skillTags.map((skill) => (
                <Button
                  key={skill}
                  type="button"
                  size="sm"
                  onClick={() => setSkillTags((prev) => prev.filter((item) => item !== skill))}
                  aria-label={`Remove skill ${skill}`}
                >
                  {skill}
                  <span aria-hidden="true">×</span>
                </Button>
              ))}
            </div>
          ) : null}
          <div className="ui-row guest-tag-add-row">
            <Field
              label="Skill tags"
              control={
                <Input
                  value={draft}
                  disabled={atSkillCap}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addSkill();
                  }}
                  autoComplete="off"
                  maxLength={ROSTER_OPS_SKILL_LENGTH_MAX}
                  data-testid={`roster-skill-${row.staffId}`}
                />
              }
            />
            <Button type="button" disabled={atSkillCap} onClick={addSkill}>
              Add
            </Button>
          </div>
          {atSkillCap ? <p className="muted">Maximum of 10 skills.</p> : null}
        </div>
      </fieldset>
    </FormDialog>
  );
}
