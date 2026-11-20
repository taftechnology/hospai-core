import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import {
  PACKAGE_COMPONENT_SCHEDULES,
  packageRoomPortionMinor,
  type PackageComponentInput,
  type PackageComponentSchedule,
  type PackageComponentTaxMode,
  type PackageListItem,
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
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { minorToMajorInput, parseMajorToMinor } from '../money.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { badgeStatusWord } from '../status/badge-status-word.js';
import { FormDialog } from '../shell/FormDialog.js';
import { usePostableProducts } from './product-picker.js';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const CODE_RE = /^[A-Z0-9_]{1,20}$/;

const SCHEDULE_LABELS: Record<PackageComponentSchedule, string> = {
  EVERY_NIGHT: 'Every night',
  ARRIVAL: 'Arrival night',
  SET_NIGHT: 'Set night',
  LAST_NIGHT: 'Last night',
};

export function packagesQueryKey(propertyId: string, status: 'active' | 'all') {
  return ['packages', propertyId, status] as const;
}

function failure(err: unknown, fallback: string): string {
  return classifiedUserMessage(asClassified(err), { fallback });
}

function newPackageId(): string {
  return `pkg_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

type ComponentDraft = {
  productId: string;
  amount: string;
  schedule: PackageComponentSchedule;
  setNight: string;
};

type PackageDraft = {
  packageId: string | null;
  code: string;
  name: string;
  roomTypeId: string;
  ratePlanId: string;
  nights: string;
  price: string;
  componentTax: PackageComponentTaxMode;
  components: ComponentDraft[];
};

function emptyComponent(): ComponentDraft {
  return { productId: '', amount: '', schedule: 'EVERY_NIGHT', setNight: '1' };
}

function draftFromRow(row: PackageListItem): PackageDraft {
  return {
    packageId: row.packageId,
    code: row.code,
    name: row.name,
    roomTypeId: row.roomTypeId,
    ratePlanId: row.ratePlanId,
    nights: String(row.nights),
    price: minorToMajorInput(row.priceMinor),
    componentTax: row.componentTax,
    components: row.components.map((c) => ({
      productId: c.productId,
      amount: minorToMajorInput(c.amountMinor),
      schedule: c.schedule,
      setNight: String(c.setNight ?? 1),
    })),
  };
}

/**
 * Settings → Packages (roadmap R4.13 A2). Fixed-price stay templates with up to 8 components.
 */
export function PackagesSettings({
  onMessage: _onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const { money } = useFormat();
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PackageDraft | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PackageListItem | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const updateOpIdRef = useRef<string | null>(null);
  const statusOpIdRef = useRef<string | null>(null);
  const createPackageIdRef = useRef<string | null>(null);

  const packagesQ = useQuery({
    queryKey: packagesQueryKey(propertyId, 'all'),
    queryFn: () => api.listPackages(propertyId, { status: 'all' }),
    retry: false,
  });
  const typesQ = useQuery({
    queryKey: ['room-types', propertyId, 'active'],
    queryFn: () => api.listRoomTypes(propertyId, { status: 'active' }),
    retry: false,
  });
  const plansQ = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.listRatePlans(propertyId),
    retry: false,
  });
  const products = usePostableProducts(true);

  const packages = packagesQ.data?.packages ?? [];
  const roomTypes = typesQ.data?.roomTypes ?? [];
  const plans = (plansQ.data?.plans ?? []).filter((p) => p.status === 'active');

  const roomPortion = useMemo(() => {
    if (!draft) return null;
    const nights = Number(draft.nights);
    if (!PRICE_RE.test(draft.price.trim()) || !Number.isInteger(nights) || nights < 1) {
      return null;
    }
    const priceMinor = parseMajorToMinor(draft.price.trim());
    const components = draft.components
      .filter((c) => c.productId && PRICE_RE.test(c.amount.trim()))
      .map((c) => ({
        amountMinor: parseMajorToMinor(c.amount.trim()),
        schedule: c.schedule,
      }));
    return packageRoomPortionMinor(priceMinor, nights, components);
  }, [draft]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['packages', propertyId] });

  const save = useMutation({
    mutationFn: (d: PackageDraft) => {
      const nights = Number(d.nights);
      const components: PackageComponentInput[] = d.components
        .filter((c) => c.productId.length > 0)
        .map((c, i) => ({
          componentNo: i + 1,
          productId: c.productId,
          amountMinor: parseMajorToMinor(c.amount.trim()),
          schedule: c.schedule,
          setNight: c.schedule === 'SET_NIGHT' ? Number(c.setNight) : null,
        }));
      const fields = {
        code: d.code.trim().toUpperCase(),
        name: d.name.trim(),
        roomTypeId: d.roomTypeId,
        ratePlanId: d.ratePlanId,
        nights,
        priceMinor: parseMajorToMinor(d.price.trim()),
        componentTax: d.componentTax,
        components,
      };
      if (d.packageId) {
        const opId =
          updateOpIdRef.current ??
          `package:update:${d.packageId}:${crypto.randomUUID()}`;
        updateOpIdRef.current = opId;
        return api.updatePackage(propertyId, d.packageId, fields, opId);
      }
      const packageId = createPackageIdRef.current ?? newPackageId();
      createPackageIdRef.current = packageId;
      return api.createPackage(propertyId, {
        packageId,
        ...fields,
      });
    },
    onSuccess: () => {
      setDraft(null);
      updateOpIdRef.current = null;
      createPackageIdRef.current = null;
      setSuccessNotice('Package saved.');
      void invalidate();
    },
    onError: (err) => setDialogError(failure(err, 'Could not save the package.')),
  });

  const setStatus = useMutation({
    mutationFn: (target: { packageId: string; status: 'active' | 'archived' }) => {
      const opId =
        statusOpIdRef.current ??
        `package:status:${target.packageId}:${target.status}:${crypto.randomUUID()}`;
      statusOpIdRef.current = opId;
      return api.setPackageStatus(propertyId, target.packageId, target.status, opId);
    },
    onSuccess: (_r, target) => {
      statusOpIdRef.current = null;
      setSuccessNotice(target.status === 'archived' ? 'Archived.' : 'Restored.');
      void invalidate();
    },
    onError: (err) => setPageError(failure(err, 'Could not change the status.')),
  });

  const draftValid =
    draft != null &&
    CODE_RE.test(draft.code.trim().toUpperCase()) &&
    draft.name.trim().length > 0 &&
    draft.roomTypeId.length > 0 &&
    draft.ratePlanId.length > 0 &&
    /^\d+$/.test(draft.nights.trim()) &&
    Number(draft.nights) >= 1 &&
    Number(draft.nights) <= 30 &&
    PRICE_RE.test(draft.price.trim()) &&
    draft.components.length <= 8 &&
    draft.components.every(
      (c) =>
        c.productId.length > 0 &&
        PRICE_RE.test(c.amount.trim()) &&
        (c.schedule !== 'SET_NIGHT' ||
          (/^\d+$/.test(c.setNight) &&
            Number(c.setNight) >= 1 &&
            Number(c.setNight) <= Number(draft.nights))),
    ) &&
    (roomPortion == null || roomPortion >= 0);

  function openNew() {
    setDialogError(null);
    setSuccessNotice(null);
    updateOpIdRef.current = null;
    createPackageIdRef.current = newPackageId();
    setDraft({
      packageId: null,
      code: '',
      name: '',
      roomTypeId: roomTypes[0]?.roomTypeId ?? '',
      ratePlanId: plans[0]?.ratePlanId ?? '',
      nights: '1',
      price: '',
      componentTax: 'SEPARATE',
      components: [],
    });
  }

  if (packagesQ.isError) {
    return (
      <Alert data-testid="packages-error">
        {failure(packagesQ.error, 'Could not load packages.')}
      </Alert>
    );
  }
  if (!packagesQ.isSuccess) return <Skeleton aria-label="Loading packages" />;

  return (
    <>
      {pageError ? <Alert>{pageError}</Alert> : null}
      {successNotice ? (
        <Alert intent="settled" data-testid="packages-success">
          {successNotice}
        </Alert>
      ) : null}
      <Card data-testid="packages-card">
        <CardHeader>
          <CardTitle>Packages</CardTitle>
          <Button type="button" size="sm" onClick={openNew}>
            Add package
          </Button>
        </CardHeader>
        <CardContent flush={packages.length > 0}>
          {packages.length === 0 ? (
            <EmptyState
              title="No packages yet"
              description="Create a fixed-price package with room type, plan, nights and components."
            />
          ) : (
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Code</DataTableHeaderCell>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Nights</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">Price</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {packages.map((row) => (
                  <DataTableRow key={row.packageId}>
                    <DataTableCell>
                      <span translate="no">{row.code}</span>
                    </DataTableCell>
                    <DataTableCell>{row.name}</DataTableCell>
                    <DataTableCell>
                      <span className="ui-num">{row.nights}</span>
                    </DataTableCell>
                    <DataTableCell align="right">
                      <span className="ui-num">{money(row.priceMinor)}</span>
                    </DataTableCell>
                    <DataTableCell>
                      <Badge rung={row.status === 'active' ? 'settled' : 'neutral'}>
                        {badgeStatusWord(row.status)}
                      </Badge>
                    </DataTableCell>
                    <DataTableCell align="right">
                      <RowActions>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setDialogError(null);
                            updateOpIdRef.current = null;
                            setDraft(draftFromRow(row));
                          }}
                        >
                          Edit
                        </Button>
                        {row.status === 'active' ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              statusOpIdRef.current = null;
                              setArchiveTarget(row);
                            }}
                          >
                            Archive
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              statusOpIdRef.current = null;
                              setStatus.mutate({
                                packageId: row.packageId,
                                status: 'active',
                              });
                            }}
                          >
                            Restore
                          </Button>
                        )}
                      </RowActions>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          )}
        </CardContent>
      </Card>

      {draft ? (
        <FormDialog
          title={draft.packageId ? 'Edit package' : 'Add package'}
          onClose={() => {
            setDraft(null);
            updateOpIdRef.current = null;
          }}
          actions={
            <>
              <Button
                type="button"
                onClick={() => {
                  setDraft(null);
                  updateOpIdRef.current = null;
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                disabled={!draftValid || save.isPending}
                onClick={() => {
                  setDialogError(null);
                  save.mutate(draft);
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="ui-stack">
            {dialogError ? <Alert intent="exception">{dialogError}</Alert> : null}
            <div className="ui-row">
              <Field
                label="Code"
                control={
                  <Input
                    aria-label="Package code"
                    value={draft.code}
                    onChange={(e) =>
                      setDraft({ ...draft, code: e.target.value.toUpperCase() })
                    }
                  />
                }
              />
              <Field
                label="Name"
                control={
                  <Input
                    aria-label="Package name"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                }
              />
            </div>
            <div className="ui-row">
              <Field
                label="Room type"
                control={
                  <NativeSelect
                    aria-label="Package room type"
                    value={draft.roomTypeId}
                    onChange={(e) => setDraft({ ...draft, roomTypeId: e.target.value })}
                  >
                    <option value="">Choose</option>
                    {roomTypes.map((t) => (
                      <option key={t.roomTypeId} value={t.roomTypeId}>
                        {t.name} ({t.code})
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              <Field
                label="Rate plan"
                control={
                  <NativeSelect
                    aria-label="Package rate plan"
                    value={draft.ratePlanId}
                    onChange={(e) => setDraft({ ...draft, ratePlanId: e.target.value })}
                  >
                    <option value="">Choose</option>
                    {plans.map((p) => (
                      <option key={p.ratePlanId} value={p.ratePlanId}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
            </div>
            <div className="ui-row">
              <Field
                label="Nights"
                control={
                  <Input
                    aria-label="Package nights"
                    value={draft.nights}
                    onChange={(e) => setDraft({ ...draft, nights: e.target.value })}
                  />
                }
              />
              <Field
                label="Price"
                control={
                  <Input
                    aria-label="Package price"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  />
                }
              />
              <Field
                label="Component tax"
                control={
                  <NativeSelect
                    aria-label="Package component tax"
                    value={draft.componentTax}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        componentTax: e.target.value as PackageComponentTaxMode,
                      })
                    }
                  >
                    <option value="SEPARATE">Separate</option>
                    <option value="ROOM">Room tax</option>
                  </NativeSelect>
                }
              />
            </div>
            {roomPortion != null ? (
              <p data-testid="package-room-portion">
                Room portion {money(roomPortion)} over {draft.nights} nights
              </p>
            ) : null}
            {roomPortion != null && roomPortion < 0 ? (
              <Alert intent="exception" data-testid="package-room-portion-alert">
                Components exceed the package price by {money(-roomPortion)}. Raise the price
                or lower component amounts.
              </Alert>
            ) : null}
            <div className="ui-stack" data-testid="package-components">
              {draft.components.map((c, idx) => (
                <div key={idx} className="ui-row">
                  <Field
                    size="sm"
                    label="Product"
                    control={
                      <NativeSelect
                        aria-label={`Component ${idx + 1} product`}
                        value={c.productId}
                        onChange={(e) => {
                          const next = [...draft.components];
                          const item = products.byId.get(e.target.value);
                          next[idx] = {
                            ...c,
                            productId: e.target.value,
                            amount: item
                              ? minorToMajorInput(item.defaultAmountMinor)
                              : c.amount,
                          };
                          setDraft({ ...draft, components: next });
                        }}
                      >
                        <option value="">Choose</option>
                        {products.groups.map((g) => (
                          <optgroup key={g.category.categoryId} label={g.category.name}>
                            {g.items.map((i) => (
                              <option key={i.productId} value={i.productId}>
                                {i.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </NativeSelect>
                    }
                  />
                  <Field
                    size="xs"
                    label="Amount"
                    control={
                      <Input
                        aria-label={`Component ${idx + 1} amount`}
                        value={c.amount}
                        onChange={(e) => {
                          const next = [...draft.components];
                          next[idx] = { ...c, amount: e.target.value };
                          setDraft({ ...draft, components: next });
                        }}
                      />
                    }
                  />
                  <Field
                    size="sm"
                    label="Schedule"
                    control={
                      <NativeSelect
                        aria-label={`Component ${idx + 1} schedule`}
                        value={c.schedule}
                        onChange={(e) => {
                          const next = [...draft.components];
                          next[idx] = {
                            ...c,
                            schedule: e.target.value as PackageComponentSchedule,
                          };
                          setDraft({ ...draft, components: next });
                        }}
                      >
                        {PACKAGE_COMPONENT_SCHEDULES.map((s) => (
                          <option key={s} value={s}>
                            {SCHEDULE_LABELS[s]}
                          </option>
                        ))}
                      </NativeSelect>
                    }
                  />
                  {c.schedule === 'SET_NIGHT' ? (
                    <Field
                      size="xs"
                      label="Night (1–N)"
                      control={
                        <Input
                          aria-label="Night (1–N)"
                          value={c.setNight}
                          onChange={(e) => {
                            const next = [...draft.components];
                            next[idx] = { ...c, setNight: e.target.value };
                            setDraft({ ...draft, components: next });
                          }}
                        />
                      }
                    />
                  ) : null}
                  <Button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        components: draft.components.filter((_, i) => i !== idx),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                disabled={draft.components.length >= 8}
                onClick={() =>
                  setDraft({
                    ...draft,
                    components: [...draft.components, emptyComponent()],
                  })
                }
              >
                Add component
              </Button>
            </div>
          </div>
        </FormDialog>
      ) : null}

      {archiveTarget ? (
        <ConfirmDialog
          title="Archive package?"
          description={`${archiveTarget.name} will leave the Book list. Existing stays keep their snapshots.`}
          confirmLabel="Archive"
          intent="destructive"
          onCancel={() => setArchiveTarget(null)}
          onConfirm={() => {
            const row = archiveTarget;
            setArchiveTarget(null);
            setStatus.mutate({ packageId: row.packageId, status: 'archived' });
          }}
        />
      ) : null}
    </>
  );
}
