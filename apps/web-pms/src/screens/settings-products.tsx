import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ProductCategoryRead, ProductItemRead } from '@hospai/client-core';
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
import { minorToMajorInput, parseMajorToMinor } from '../money.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { badgeStatusWord } from '../status/badge-status-word.js';
import { FormDialog } from '../shell/FormDialog.js';
import { NON_INCIDENTAL_CODES } from './board-dialogs.js';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

export function productsQueryKey(propertyId: string, status: 'active' | 'all') {
  return ['products', propertyId, status] as const;
}

function failure(err: unknown, fallback: string): string {
  return classifiedUserMessage(asClassified(err), { fallback });
}

function newId(prefix: 'cat' | 'prod'): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

type ItemDraft = {
  productId: string | null;
  name: string;
  categoryId: string;
  chargeCode: string;
  price: string;
  sku: string;
};

/**
 * Settings → Products (roadmap R1.5). Categories and priced items over the
 * products module. The tax group shown is the charge code's (spec §2.3).
 */
export function ProductsSettings({ onMessage }: { onMessage: (message: string) => void }) {
  const { money } = useFormat();
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const [categoryDraft, setCategoryDraft] = useState<{ categoryId: string | null; name: string } | null>(
    null,
  );
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<
    { kind: 'category'; row: ProductCategoryRead } | { kind: 'item'; row: ProductItemRead } | null
  >(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const productsQ = useQuery({
    queryKey: productsQueryKey(propertyId, 'all'),
    queryFn: () => api.listProducts(propertyId, { status: 'all' }),
    retry: false,
  });
  const codesQ = useQuery({
    queryKey: ['charge-codes', propertyId],
    queryFn: () => api.listChargeCodes(propertyId, { status: 'all' }),
    retry: false,
  });
  const postableCodes = useMemo(
    () =>
      ((codesQ.data?.codes ?? []) as Array<{ code: string; name: string; status?: string }>).filter(
        (c) => c.status !== 'archived' && !NON_INCIDENTAL_CODES.has(c.code),
      ),
    [codesQ.data],
  );

  const categories = productsQ.data?.categories ?? [];
  const items = productsQ.data?.items ?? [];
  const activeCategories = categories.filter((c) => c.status === 'active');
  const categoryName = new Map(categories.map((c) => [c.categoryId, c.name]));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['products', propertyId] });

  const saveCategory = useMutation({
    mutationFn: (draft: { categoryId: string | null; name: string }) =>
      draft.categoryId
        ? api.updateProductCategory(propertyId, draft.categoryId, { name: draft.name.trim() })
        : api.createProductCategory(propertyId, { categoryId: newId('cat'), name: draft.name.trim() }),
    onSuccess: () => {
      setCategoryDraft(null);
      onMessage('Category saved.');
      void invalidate();
    },
    onError: (err) => setDialogError(failure(err, 'Could not save the category.')),
  });

  const saveItem = useMutation({
    mutationFn: (draft: ItemDraft) => {
      const fields = {
        name: draft.name.trim(),
        categoryId: draft.categoryId,
        chargeCode: draft.chargeCode,
        defaultAmountMinor: parseMajorToMinor(draft.price.trim()),
        sku: draft.sku.trim() || null,
      };
      return draft.productId
        ? api.updateProduct(propertyId, draft.productId, fields)
        : api.createProduct(propertyId, { productId: newId('prod'), ...fields });
    },
    onSuccess: () => {
      setItemDraft(null);
      onMessage('Product saved.');
      void invalidate();
    },
    onError: (err) => setDialogError(failure(err, 'Could not save the product.')),
  });

  const setStatus = useMutation({
    mutationFn: (target: {
      kind: 'category' | 'item';
      id: string;
      status: 'active' | 'archived';
    }) =>
      target.kind === 'category'
        ? api.updateProductCategory(propertyId, target.id, { status: target.status })
        : api.updateProduct(propertyId, target.id, { status: target.status }),
    onSuccess: (_r, target) => {
      onMessage(target.status === 'archived' ? 'Archived.' : 'Restored.');
      void invalidate();
    },
    onError: (err) => setPageError(failure(err, 'Could not change the status.')),
  });

  const itemDraftValid =
    itemDraft != null &&
    itemDraft.name.trim().length > 0 &&
    itemDraft.categoryId.length > 0 &&
    itemDraft.chargeCode.length > 0 &&
    PRICE_RE.test(itemDraft.price.trim());

  function openNewItem() {
    setDialogError(null);
    setItemDraft({
      productId: null,
      name: '',
      categoryId: activeCategories[0]?.categoryId ?? '',
      chargeCode: postableCodes.find((c) => c.code === 'MISC')?.code ?? postableCodes[0]?.code ?? '',
      price: '',
      sku: '',
    });
  }

  if (productsQ.isError) {
    return (
      <Alert data-testid="products-error">
        {failure(productsQ.error, 'Could not load products.')}
      </Alert>
    );
  }
  if (!productsQ.isSuccess) return <Skeleton aria-label="Loading products" />;

  return (
    <>
      {pageError ? <Alert>{pageError}</Alert> : null}
      <Card data-testid="products-categories">
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setDialogError(null);
              setCategoryDraft({ categoryId: null, name: '' });
            }}
          >
            Add category
          </Button>
        </CardHeader>
        <CardContent flush={categories.length > 0}>
          {categories.length === 0 ? (
            <EmptyState
              title="No categories yet"
              description="Add a category such as Minibar or Laundry, then add its products."
            />
          ) : (
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Products</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">
                    <span className="ui-visually-hidden">Actions</span>
                  </DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {categories.map((c) => (
                  <DataTableRow key={c.categoryId}>
                    <DataTableCell>{c.name}</DataTableCell>
                    <DataTableCell>
                      <span className="ui-num">
                        {items.filter((i) => i.categoryId === c.categoryId && i.status === 'active').length}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      <Badge rung={c.status === 'active' ? 'settled' : 'neutral'}>{badgeStatusWord(c.status)}</Badge>
                    </DataTableCell>
                    <DataTableCell align="right">
                      <RowActions>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setDialogError(null);
                            setCategoryDraft({ categoryId: c.categoryId, name: c.name });
                          }}
                        >
                          Rename
                        </Button>
                        {c.status === 'active' ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => setArchiveTarget({ kind: 'category', row: c })}
                          >
                            Archive
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              setStatus.mutate({ kind: 'category', id: c.categoryId, status: 'active' })
                            }
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

      <Card data-testid="products-items">
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <Button
            type="button"
            size="sm"
            disabled={activeCategories.length === 0}
            onClick={openNewItem}
          >
            Add product
          </Button>
        </CardHeader>
        <CardContent flush={items.length > 0}>
          {items.length === 0 ? (
            <EmptyState
              title="No products yet"
              description={
                activeCategories.length === 0
                  ? 'Add a category first.'
                  : 'Add products with a default price; the desk can change it when posting.'
              }
            />
          ) : (
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>SKU</DataTableHeaderCell>
                  <DataTableHeaderCell>Category</DataTableHeaderCell>
                  <DataTableHeaderCell>Charge code</DataTableHeaderCell>
                  <DataTableHeaderCell>Tax group</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">Price</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell align="right">
                    <span className="ui-visually-hidden">Actions</span>
                  </DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {items.map((i) => (
                  <DataTableRow key={i.productId}>
                    <DataTableCell>{i.name}</DataTableCell>
                    <DataTableCell>{i.sku ?? <span className="muted">—</span>}</DataTableCell>
                    <DataTableCell>{categoryName.get(i.categoryId) ?? i.categoryId}</DataTableCell>
                    <DataTableCell>
                      <span translate="no">{i.chargeCode}</span>
                    </DataTableCell>
                    <DataTableCell>{i.taxGroup ?? <span className="muted">Exempt</span>}</DataTableCell>
                    <DataTableCell align="right">
                      <span className="ui-num">{money(i.defaultAmountMinor)}</span>
                    </DataTableCell>
                    <DataTableCell>
                      {i.status === 'archived' ? (
                        <Badge rung="neutral">Archived</Badge>
                      ) : i.postable ? (
                        <Badge rung="settled">Active</Badge>
                      ) : (
                        <Badge rung="attention">not postable</Badge>
                      )}
                    </DataTableCell>
                    <DataTableCell align="right">
                      <RowActions>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setDialogError(null);
                            setItemDraft({
                              productId: i.productId,
                              name: i.name,
                              categoryId: i.categoryId,
                              chargeCode: i.chargeCode,
                              price: minorToMajorInput(i.defaultAmountMinor),
                              sku: i.sku ?? '',
                            });
                          }}
                        >
                          Edit
                        </Button>
                        {i.status === 'active' ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => setArchiveTarget({ kind: 'item', row: i })}
                          >
                            Archive
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              setStatus.mutate({ kind: 'item', id: i.productId, status: 'active' })
                            }
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
          {items.some((i) => i.status === 'active' && !i.postable) ? (
            <p className="muted">
              “Not postable” products use an archived charge code or sit in an archived category —
              the desk does not see them until that is fixed.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {categoryDraft ? (
        <FormDialog
          title={categoryDraft.categoryId ? 'Rename category' : 'Add category'}
          onClose={() => setCategoryDraft(null)}
          actions={
            <>
              <Button type="button" onClick={() => setCategoryDraft(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                disabled={categoryDraft.name.trim().length === 0 || saveCategory.isPending}
                onClick={() => {
                  setDialogError(null);
                  saveCategory.mutate(categoryDraft);
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <Field
            label="Category name"
            control={
              <Input
                value={categoryDraft.name}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })}
              />
            }
          />
          {dialogError ? <Alert>{dialogError}</Alert> : null}
        </FormDialog>
      ) : null}

      {itemDraft ? (
        <FormDialog
          title={itemDraft.productId ? 'Edit product' : 'Add product'}
          onClose={() => setItemDraft(null)}
          actions={
            <>
              <Button type="button" onClick={() => setItemDraft(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                disabled={!itemDraftValid || saveItem.isPending}
                onClick={() => {
                  setDialogError(null);
                  saveItem.mutate(itemDraft);
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <Field
            label="Product name"
            control={
              <Input
                value={itemDraft.name}
                onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })}
              />
            }
          />
          <Field
            label="Category"
            control={
              <NativeSelect
                value={itemDraft.categoryId}
                onChange={(e) => setItemDraft({ ...itemDraft, categoryId: e.target.value })}
              >
                {activeCategories.map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Charge code"
            hint="The tax group comes from the charge code."
            control={
              <NativeSelect
                value={itemDraft.chargeCode}
                onChange={(e) => setItemDraft({ ...itemDraft, chargeCode: e.target.value })}
              >
                {postableCodes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Default price"
            control={
              <Input
                placeholder="0.00"
                value={itemDraft.price}
                onChange={(e) => setItemDraft({ ...itemDraft, price: e.target.value })}
              />
            }
          />
          <Field
            label="SKU (optional)"
            control={
              <Input
                value={itemDraft.sku}
                onChange={(e) => setItemDraft({ ...itemDraft, sku: e.target.value })}
              />
            }
          />
          {dialogError ? <Alert>{dialogError}</Alert> : null}
        </FormDialog>
      ) : null}

      {archiveTarget ? (
        <ConfirmDialog
          title={archiveTarget.kind === 'category' ? 'Archive category?' : 'Archive product?'}
          description={
            archiveTarget.kind === 'category'
              ? `${archiveTarget.row.name} and its products leave the desk's pickers. Past charges are not changed.`
              : `${archiveTarget.row.name} leaves the desk's pickers. Past charges are not changed.`
          }
          confirmLabel="Archive"
          intent="destructive"
          onCancel={() => setArchiveTarget(null)}
          onConfirm={() => {
            const target = archiveTarget;
            setArchiveTarget(null);
            setPageError(null);
            setStatus.mutate({
              kind: target.kind,
              id: target.kind === 'category' ? target.row.categoryId : target.row.productId,
              status: 'archived',
            });
          }}
        />
      ) : null}
    </>
  );
}
