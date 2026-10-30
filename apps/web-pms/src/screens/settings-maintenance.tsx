import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_CATEGORY_LABEL,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_LABEL,
  type MaintenanceCategory,
  type MaintenancePriority,
} from '@hospai/contracts';
import {
  Alert,
  Badge,
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
  Input,
  NativeSelect,
  RowActions,
  Skeleton,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { FormDialog } from '../shell/FormDialog.js';

export function maintenanceTaskTypesQueryKey(propertyId: string) {
  return ['maintenance-task-types', propertyId] as const;
}

type Draft = {
  taskTypeId: string | null;
  name: string;
  category: MaintenanceCategory;
  defaultPriority: MaintenancePriority;
  checklist: string[];
  active: boolean;
};

const emptyDraft = (): Draft => ({
  taskTypeId: null,
  name: '',
  category: 'other',
  defaultPriority: 'medium',
  checklist: [''],
  active: true,
});

export function MaintenanceSettings({ onMessage }: { onMessage: (message: string) => void }) {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const typesQ = useQuery({
    queryKey: maintenanceTaskTypesQueryKey(propertyId),
    queryFn: () => api.getMaintenanceTaskTypes(propertyId),
    retry: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: maintenanceTaskTypesQueryKey(propertyId) });

  const saveMutation = useMutation({
    mutationFn: (d: Draft) => {
      const checklist = d.checklist.map((s) => s.trim()).filter(Boolean);
      const id = d.taskTypeId ?? `tt_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const op = crypto.randomUUID();
      if (d.taskTypeId) {
        return api.updateMaintenanceTaskType(
          propertyId,
          d.taskTypeId,
          {
            name: d.name.trim(),
            category: d.category,
            defaultPriority: d.defaultPriority,
            checklist,
            active: d.active,
          },
          op,
        );
      }
      return api.createMaintenanceTaskType(
        propertyId,
        {
          taskTypeId: id,
          name: d.name.trim(),
          category: d.category,
          defaultPriority: d.defaultPriority,
          checklist,
        },
        op,
      );
    },
    onSuccess: async () => {
      setDraft(null);
      setDialogError(null);
      onMessage('Task type saved.');
      await invalidate();
    },
    onError: (err) =>
      setDialogError(classifiedUserMessage(asClassified(err), { fallback: 'Could not save this task type.' })),
  });

  const types = typesQ.data?.taskTypes ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance task types</CardTitle>
        <Button type="button" intent="primary" onClick={() => setDraft(emptyDraft())}>
          Add task type
        </Button>
      </CardHeader>
      <CardContent flush>
        {typesQ.isLoading ? <Skeleton /> : null}
        {typesQ.isError ? (
          <Alert intent="exception">
            {classifiedUserMessage(asClassified(typesQ.error), { fallback: 'Could not load task types.' })}
          </Alert>
        ) : null}
        {typesQ.isSuccess && types.length === 0 ? (
          <EmptyState title="No task types yet." />
        ) : null}
        {types.length > 0 ? (
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Name</DataTableHeaderCell>
                <DataTableHeaderCell>Category</DataTableHeaderCell>
                <DataTableHeaderCell>Default priority</DataTableHeaderCell>
                <DataTableHeaderCell>Items</DataTableHeaderCell>
                <DataTableHeaderCell>Active</DataTableHeaderCell>
                <DataTableHeaderCell>Actions</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {types.map((row) => (
                <DataTableRow key={row.taskTypeId}>
                  <DataTableCell>{row.name}</DataTableCell>
                  <DataTableCell>{MAINTENANCE_CATEGORY_LABEL[row.category]}</DataTableCell>
                  <DataTableCell>{MAINTENANCE_PRIORITY_LABEL[row.defaultPriority]}</DataTableCell>
                  <DataTableCell>{row.checklist.length}</DataTableCell>
                  <DataTableCell>
                    <Badge rung={row.active ? 'informational' : 'attention'}>
                      {row.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </DataTableCell>
                  <DataTableCell>
                    <RowActions>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          setDraft({
                            taskTypeId: row.taskTypeId,
                            name: row.name,
                            category: row.category,
                            defaultPriority: row.defaultPriority,
                            checklist: row.checklist.length ? [...row.checklist] : [''],
                            active: row.active,
                          })
                        }
                      >
                        Edit
                      </Button>
                    </RowActions>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        ) : null}
      </CardContent>

      {draft ? (
        <FormDialog
          title={draft.taskTypeId ? 'Edit task type' : 'Add task type'}
          onClose={() => setDraft(null)}
          actions={
            <>
              <Button type="button" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                disabled={!draft.name.trim() || saveMutation.isPending}
                onClick={() => saveMutation.mutate(draft)}
              >
                Save
              </Button>
            </>
          }
        >
          {dialogError ? <Alert intent="exception">{dialogError}</Alert> : null}
          <div className="stack">
            <Field
              label="Name"
              control={
                <Input
                  value={draft.name}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              }
            />
            <Field
              label="Category"
              control={
                <NativeSelect
                  aria-label="Category"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value as MaintenanceCategory })
                  }
                >
                  {MAINTENANCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {MAINTENANCE_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              label="Default priority"
              control={
                <NativeSelect
                  aria-label="Default priority"
                  value={draft.defaultPriority}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      defaultPriority: e.target.value as MaintenancePriority,
                    })
                  }
                >
                  {MAINTENANCE_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {MAINTENANCE_PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            {draft.taskTypeId ? (
              <Field
                label="Active"
                control={
                  <NativeSelect
                    aria-label="Active"
                    value={draft.active ? '1' : '0'}
                    onChange={(e) => setDraft({ ...draft, active: e.target.value === '1' })}
                  >
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </NativeSelect>
                }
              />
            ) : null}
            <fieldset className="stack">
              <legend>Checklist</legend>
              {draft.checklist.map((line, i) => (
                <div key={`cl-${i}`} className="maintenance-checklist-row">
                  <Field
                    label={`Checklist item ${i + 1}`}
                    control={
                      <Input
                        value={line}
                        maxLength={80}
                        onChange={(e) => {
                          const next = [...draft.checklist];
                          next[i] = e.target.value;
                          setDraft({ ...draft, checklist: next });
                        }}
                      />
                    }
                  />
                  <Button
                    type="button"
                    intent="default"
                    disabled={draft.checklist.length <= 1}
                    onClick={() => {
                      const next = draft.checklist.filter((_, j) => j !== i);
                      setDraft({ ...draft, checklist: next.length ? next : [''] });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                disabled={draft.checklist.length >= 20}
                onClick={() => setDraft({ ...draft, checklist: [...draft.checklist, ''] })}
              >
                Add row
              </Button>
            </fieldset>
          </div>
        </FormDialog>
      ) : null}
    </Card>
  );
}
