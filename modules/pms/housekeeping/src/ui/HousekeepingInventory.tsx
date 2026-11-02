import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HousekeepingInventoryCategory,
  HousekeepingInventoryItemRow,
  HousekeepingInventoryMovementKind,
} from '@hospai/contracts';
import { HOUSEKEEPING_INVENTORY_CATEGORIES } from '@hospai/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
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
  Skeleton,
  Toolbar,
} from '@hospai/ui-kit';
import { useMemo, useState, type ReactNode } from 'react';
import type { HousekeepingApi, HousekeepingFormDialogProps } from './housekeeping-types.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import { INVENTORY_CATEGORY_LABEL, MOVEMENT_KIND_LABEL } from './inventory-labels.js';

type AdjustDialog = {
  kind: HousekeepingInventoryMovementKind;
  item: HousekeepingInventoryItemRow;
};

export function HousekeepingInventory({
  propertyId,
  api,
  canAssign,
  subtitle,
  formatError,
  Dialog,
  format,
}: {
  propertyId: string;
  api: HousekeepingApi;
  canAssign: boolean;
  subtitle?: string;
  formatError?: (err: unknown) => string;
  Dialog?: (props: HousekeepingFormDialogProps) => ReactNode;
  format: { dateTime: (ms: number) => string };
}) {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [itemId, setItemId] = useState(() => `hk_item_${crypto.randomUUID()}`);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<HousekeepingInventoryCategory>('linens');
  const [unit, setUnit] = useState('each');
  const [parLevel, setParLevel] = useState('10');
  const [onHand, setOnHand] = useState('0');

  const [adjustDialog, setAdjustDialog] = useState<AdjustDialog | null>(null);
  const [adjustQty, setAdjustQty] = useState('1');
  const [adjustNote, setAdjustNote] = useState('');

  const [editItem, setEditItem] = useState<HousekeepingInventoryItemRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<HousekeepingInventoryCategory>('linens');
  const [editUnit, setEditUnit] = useState('');
  const [editPar, setEditPar] = useState('');
  const [editArchived, setEditArchived] = useState(false);

  const [historyItem, setHistoryItem] = useState<HousekeepingInventoryItemRow | null>(null);

  const inventoryQuery = useQuery({
    queryKey: ['housekeeping-inventory', propertyId, { archived: showArchived }],
    queryFn: () => api.getHousekeepingInventory(propertyId, { archived: showArchived }),
  });

  const movementsQuery = useQuery({
    queryKey: ['housekeeping-inventory-movements', propertyId, historyItem?.itemId ?? ''],
    queryFn: () => api.getHousekeepingInventoryMovements(propertyId, historyItem!.itemId),
    enabled: historyItem != null,
  });

  const items = inventoryQuery.data?.items ?? [];
  const lowCount = useMemo(() => items.filter((i) => i.low && !i.archived).length, [items]);

  async function invalidateInventory() {
    await queryClient.invalidateQueries({ queryKey: ['housekeeping-inventory', propertyId] });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.createHousekeepingInventoryItem(
        propertyId,
        {
          itemId,
          name: name.trim(),
          category,
          unit: unit.trim(),
          parLevel: Number.parseInt(parLevel, 10),
          onHand: Number.parseInt(onHand, 10),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setFormError(null);
      setName('');
      setCategory('linens');
      setUnit('each');
      setParLevel('10');
      setOnHand('0');
      setItemId(`hk_item_${crypto.randomUUID()}`);
      await invalidateInventory();
    },
    onError: (err) => setFormError(formatError?.(err) ?? 'Could not add item.'),
  });

  const adjustMutation = useMutation({
    mutationFn: (input: { itemId: string; kind: HousekeepingInventoryMovementKind; quantity: number; note?: string }) =>
      api.adjustHousekeepingInventoryItem(propertyId, input.itemId, input, crypto.randomUUID()),
    onSuccess: async (_data, vars) => {
      setAdjustDialog(null);
      await invalidateInventory();
      await queryClient.invalidateQueries({
        queryKey: ['housekeeping-inventory-movements', propertyId, vars.itemId],
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: {
      itemId: string;
      name: string;
      category: HousekeepingInventoryCategory;
      unit: string;
      parLevel: number;
      archived: boolean;
    }) =>
      api.updateHousekeepingInventoryItem(
        propertyId,
        input.itemId,
        {
          name: input.name,
          category: input.category,
          unit: input.unit,
          parLevel: input.parLevel,
          archived: input.archived,
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setEditItem(null);
      await invalidateInventory();
    },
  });

  const writeDisabledReason = canAssign
    ? null
    : 'You need housekeeping write permission to add or change inventory.';

  return (
    <div className="ui-page-stack">
      <PageHeader title="Housekeeping inventory" subtitle={subtitle} />
      <HousekeepingNav view="inventory" />
      <Card>
        <Toolbar>
          <span className="ui-metric">
            {items.length} item{items.length === 1 ? '' : 's'}
            {lowCount > 0 ? ` · ${lowCount} low` : ''}
          </span>
          <Field
            size="sm"
            label="Show archived"
            control={
              <Checkbox
                aria-label="Show archived"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
            }
          />
        </Toolbar>
        <CardContent>
          <form
            className="ui-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canAssign) return;
              createMutation.mutate();
            }}
          >
            <Field
              label="Name"
              control={
                <Input
                  aria-label="Item name"
                  value={name}
                  disabled={!canAssign}
                  onChange={(e) => setName(e.target.value)}
                />
              }
            />
            <Field
              label="Category"
              control={
                <NativeSelect
                  aria-label="Category"
                  value={category}
                  disabled={!canAssign}
                  onChange={(e) => setCategory(e.target.value as HousekeepingInventoryCategory)}
                >
                  {HOUSEKEEPING_INVENTORY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {INVENTORY_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <Field
              label="Unit"
              control={
                <Input
                  aria-label="Unit"
                  value={unit}
                  disabled={!canAssign}
                  onChange={(e) => setUnit(e.target.value)}
                />
              }
            />
            <Field
              label="Par level"
              control={
                <Input
                  aria-label="Par level"
                  type="number"
                  value={parLevel}
                  disabled={!canAssign}
                  onChange={(e) => setParLevel(e.target.value)}
                />
              }
            />
            <Field
              label="On hand"
              control={
                <Input
                  aria-label="On hand"
                  type="number"
                  value={onHand}
                  disabled={!canAssign}
                  onChange={(e) => setOnHand(e.target.value)}
                />
              }
            />
            <Button type="submit" intent="primary" disabled={!canAssign || createMutation.isPending}>
              Add item
            </Button>
          </form>
          {writeDisabledReason ? <p>{writeDisabledReason}</p> : null}
          {formError ? <Alert>{formError}</Alert> : null}
          {createMutation.isError && !formError ? (
            <Alert>{formatError?.(createMutation.error) ?? 'Could not add item.'}</Alert>
          ) : null}
        </CardContent>
        <CardContent flush>
          {inventoryQuery.isLoading ? <Skeleton data-testid="hk-inventory-loading" /> : null}
          {inventoryQuery.isError ? (
            <Alert>{formatError?.(inventoryQuery.error) ?? 'Could not load inventory.'}</Alert>
          ) : null}
          {inventoryQuery.isSuccess && items.length === 0 ? (
            <EmptyState
              title="No inventory items yet."
              description="Add linens, toiletries, and other stock to track par levels."
            />
          ) : null}
          {inventoryQuery.isSuccess && items.length > 0 ? (
            <DataTable data-testid="hk-inventory-table">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Category</DataTableHeaderCell>
                  <DataTableHeaderCell>On hand / par</DataTableHeaderCell>
                  <DataTableHeaderCell>Unit</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {items.map((item) => (
                  <DataTableRow key={item.itemId}>
                    <DataTableCell>
                      <span className="ui-row">
                        {item.name}
                        {item.low && !item.archived ? <Badge rung="attention">Low</Badge> : null}
                        {item.archived ? <Badge rung="neutral">Archived</Badge> : null}
                      </span>
                    </DataTableCell>
                    <DataTableCell>{INVENTORY_CATEGORY_LABEL[item.category]}</DataTableCell>
                    <DataTableCell>
                      {item.onHand} / {item.parLevel}
                    </DataTableCell>
                    <DataTableCell>{item.unit}</DataTableCell>
                    <DataTableCell>
                      <RowActions>
                        <Button
                          type="button"
                          intent="ghost"
                          disabled={!canAssign || item.archived}
                          onClick={() => {
                            setAdjustDialog({ kind: 'receive', item });
                            setAdjustQty('1');
                            setAdjustNote('');
                          }}
                          aria-label={`Receive ${item.name}`}
                        >
                          Receive
                        </Button>
                        <Button
                          type="button"
                          intent="ghost"
                          disabled={!canAssign || item.archived}
                          onClick={() => {
                            setAdjustDialog({ kind: 'issue', item });
                            setAdjustQty('1');
                            setAdjustNote('');
                          }}
                          aria-label={`Issue ${item.name}`}
                        >
                          Issue
                        </Button>
                        <Button
                          type="button"
                          intent="ghost"
                          disabled={!canAssign || item.archived}
                          onClick={() => {
                            setAdjustDialog({ kind: 'count', item });
                            setAdjustQty(String(item.onHand));
                            setAdjustNote('');
                          }}
                          aria-label={`Count ${item.name}`}
                        >
                          Count
                        </Button>
                        <Button
                          type="button"
                          intent="ghost"
                          disabled={!canAssign}
                          onClick={() => {
                            setEditItem(item);
                            setEditName(item.name);
                            setEditCategory(item.category);
                            setEditUnit(item.unit);
                            setEditPar(String(item.parLevel));
                            setEditArchived(item.archived);
                          }}
                          aria-label={`Edit ${item.name}`}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          intent="ghost"
                          onClick={() => setHistoryItem(item)}
                          aria-label={`History ${item.name}`}
                        >
                          History
                        </Button>
                      </RowActions>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
      </Card>

      {adjustDialog && Dialog ? (
        <Dialog
          title={`${MOVEMENT_KIND_LABEL[adjustDialog.kind]} — ${adjustDialog.item.name}`}
          onClose={() => setAdjustDialog(null)}
          actions={
            <>
              <Button type="button" intent="ghost" onClick={() => setAdjustDialog(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                disabled={adjustMutation.isPending}
                onClick={() => {
                  adjustMutation.mutate({
                    itemId: adjustDialog.item.itemId,
                    kind: adjustDialog.kind,
                    quantity: Number.parseInt(adjustQty, 10),
                    note: adjustNote.trim() || undefined,
                  });
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <Field
            label="Quantity"
            control={
              <Input
                aria-label="Quantity"
                type="number"
                value={adjustQty}
                onChange={(e) => setAdjustQty(e.target.value)}
              />
            }
          />
          <Field
            label="Note"
            control={
              <Input
                aria-label="Note"
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
              />
            }
          />
          {adjustMutation.isError ? (
            <Alert>{formatError?.(adjustMutation.error) ?? 'Adjustment failed.'}</Alert>
          ) : null}
        </Dialog>
      ) : null}

      {editItem && Dialog ? (
        <Dialog
          title={`Edit — ${editItem.name}`}
          onClose={() => setEditItem(null)}
          actions={
            <>
              <Button type="button" intent="ghost" onClick={() => setEditItem(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                disabled={updateMutation.isPending}
                onClick={() => {
                  updateMutation.mutate({
                    itemId: editItem.itemId,
                    name: editName.trim(),
                    category: editCategory,
                    unit: editUnit.trim(),
                    parLevel: Number.parseInt(editPar, 10),
                    archived: editArchived,
                  });
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <Field
            label="Name"
            control={<Input aria-label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />}
          />
          <Field
            label="Category"
            control={
              <NativeSelect
                aria-label="Category"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value as HousekeepingInventoryCategory)}
              >
                {HOUSEKEEPING_INVENTORY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {INVENTORY_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Unit"
            control={<Input aria-label="Unit" value={editUnit} onChange={(e) => setEditUnit(e.target.value)} />}
          />
          <Field
            label="Par level"
            control={
              <Input
                aria-label="Par level"
                type="number"
                value={editPar}
                onChange={(e) => setEditPar(e.target.value)}
              />
            }
          />
          <Field
            label="Archive"
            control={
              <Checkbox
                aria-label="Archive item"
                checked={editArchived}
                onChange={(e) => setEditArchived(e.target.checked)}
              />
            }
          />
          {updateMutation.isError ? (
            <Alert>{formatError?.(updateMutation.error) ?? 'Update failed.'}</Alert>
          ) : null}
        </Dialog>
      ) : null}

      {historyItem && Dialog ? (
        <Dialog
          title={`History — ${historyItem.name}`}
          onClose={() => setHistoryItem(null)}
          actions={
            <Button type="button" intent="primary" onClick={() => setHistoryItem(null)}>
              Close
            </Button>
          }
        >
          {movementsQuery.isLoading ? <Skeleton data-testid="hk-movements-loading" /> : null}
          {movementsQuery.isError ? (
            <Alert>{formatError?.(movementsQuery.error) ?? 'Could not load movements.'}</Alert>
          ) : null}
          {movementsQuery.isSuccess && movementsQuery.data.movements.length === 0 ? (
            <EmptyState
              title="No movements yet."
              description="Receive, issue, and count actions appear here."
            />
          ) : null}
          {movementsQuery.isSuccess && movementsQuery.data.movements.length > 0 ? (
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>When</DataTableHeaderCell>
                  <DataTableHeaderCell>Action</DataTableHeaderCell>
                  <DataTableHeaderCell>Qty</DataTableHeaderCell>
                  <DataTableHeaderCell>On hand after</DataTableHeaderCell>
                  <DataTableHeaderCell>Note</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {movementsQuery.data.movements.map((m) => (
                  <DataTableRow key={m.movementId}>
                    <DataTableCell>{format.dateTime(m.createdAt)}</DataTableCell>
                    <DataTableCell>{MOVEMENT_KIND_LABEL[m.kind]}</DataTableCell>
                    <DataTableCell>{m.quantity}</DataTableCell>
                    <DataTableCell>{m.onHandAfter}</DataTableCell>
                    <DataTableCell>{m.note ?? '—'}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
