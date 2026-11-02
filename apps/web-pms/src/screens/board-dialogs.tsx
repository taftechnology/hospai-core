import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FrontDeskItem, PropertyFormat } from '@hospai/client-core';
import { Alert, Button, Field, Input, NativeSelect, Skeleton, roomStatusWord } from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { minorToMajorInput, parseMajorToMinor } from '../money.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { usePostableProducts } from './product-picker.js';
import { FormDialog } from '../shell/FormDialog.js';

function failureCopy(err: unknown, fallback: string, fmt?: PropertyFormat): string {
  return classifiedUserMessage(asClassified(err), { fallback, fmt });
}

function isQueued(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result != null &&
    (result as { classified?: { class?: string } }).classified?.class === 'provisional'
  );
}

/**
 * Codes an operator never posts as an incidental: `SYSTEM_CHARGE_CODES` in
 * packages/do-runtime (the DO writes them, or money-ops owns them — DAMAGE is
 * authorize/forfeit) plus TAX, which the tax engine posts. A test pins the
 * system half against do-runtime.
 */
export const NON_INCIDENTAL_CODES: ReadonlySet<string> = new Set([
  'ROOM',
  'PAYMENT',
  'CANCEL',
  'NO_SHOW',
  'DISCOUNT',
  'DAMAGE',
  'FX_GAIN',
  'FX_LOSS',
  'CHARGEBACK_FEE',
  'TAX',
]);

/** Positive amount with at most two decimals — the folio's major-unit field shape. */
export function validAmount(raw: string): boolean {
  if (!/^\d+(\.\d{1,2})?$/.test(raw.trim())) return false;
  return parseMajorToMinor(raw.trim()) > 0;
}

/**
 * Assign a physical room from the arrivals board (R1.3): lists the free rooms
 * of the booked type for the stay and POSTs `reservations.assign_room`.
 * Dirty rooms are listed — assignment allows them; check-in keeps its gate.
 */
export function AssignRoomDialog({
  row,
  guestName,
  onClose,
  onDone,
}: {
  row: FrontDeskItem;
  guestName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const { fmt } = useFormat();
  const propertyId = tenant.propertyId;
  const roomTypeId = typeof row.roomTypeId === 'string' ? row.roomTypeId : undefined;
  const arrival = row.arrivalDate ?? '';
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const freeQ = useQuery({
    queryKey: ['front-desk-available', propertyId, arrival, row.departureDate, roomTypeId ?? null],
    queryFn: () =>
      api.getAvailableRooms(propertyId, {
        fromDate: arrival,
        toDate: row.departureDate,
        ...(roomTypeId ? { roomTypeId } : {}),
      }),
    enabled: arrival.length > 0,
    retry: false,
  });
  const rooms = freeQ.data?.rooms ?? [];
  const chosen = roomId || rooms[0]?.roomId || '';

  const assign = useMutation({
    mutationFn: () =>
      api.assignRoom(propertyId, row.reservationId, chosen, `assign:${row.reservationId}:${chosen}`),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['front-desk-tape', propertyId] });
      void queryClient.invalidateQueries({ queryKey: ['front-desk-available', propertyId] });
      void queryClient.invalidateQueries({ queryKey: ['front-desk-summary', propertyId] });
      const code = rooms.find((r) => r.roomId === chosen)?.code ?? chosen;
      onDone(
        isQueued(result)
          ? 'Request queued — will apply when the property is reachable.'
          : `Room ${code} assigned to ${guestName}.`,
      );
    },
    onError: (err) => setError(failureCopy(err, 'Could not assign the room.', fmt)),
  });

  let body;
  if (freeQ.isError) {
    body = <Alert>{failureCopy(freeQ.error, 'Could not load free rooms.', fmt)}</Alert>;
  } else if (!freeQ.isSuccess) {
    body = <Skeleton aria-label="Loading free rooms" />;
  } else if (rooms.length === 0) {
    body = <p className="muted">No free room of this type for the whole stay.</p>;
  } else {
    body = (
      <Field
        label="Room"
        control={
          <NativeSelect value={chosen} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.map((r) => (
              <option key={r.roomId} value={r.roomId}>
                {r.code} · {roomStatusWord(r.status)}
              </option>
            ))}
          </NativeSelect>
        }
      />
    );
  }

  return (
    <FormDialog
      title={`Assign room — ${guestName}`}
      onClose={onClose}
      actions={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            intent="primary"
            disabled={!chosen || assign.isPending}
            onClick={() => {
              setError(null);
              assign.mutate();
            }}
          >
            Assign
          </Button>
        </>
      }
    >
      {body}
      {error ? <Alert>{error}</Alert> : null}
    </FormDialog>
  );
}

/**
 * Post an incidental charge from the board (R1.3) through the existing
 * `folio.add_item` route. The server enforces `no_post` and folio state.
 */
export function PostChargeDialog({
  row,
  guestName,
  onClose,
  onDone,
}: {
  row: FrontDeskItem;
  guestName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const { money, fmt } = useFormat();
  const propertyId = tenant.propertyId;
  const [opId] = useState(() => `incidental:${row.reservationId}:${crypto.randomUUID()}`);
  const [code, setCode] = useState('');
  const [productId, setProductId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const products = usePostableProducts();

  const codesQ = useQuery({
    queryKey: ['charge-codes', propertyId],
    queryFn: () => api.listChargeCodes(propertyId, { status: 'all' }),
    retry: false,
  });
  const codes = (
    (codesQ.data?.codes ?? []) as Array<{ code: string; name: string; status?: string }>
  ).filter((c) => c.status !== 'archived' && !NON_INCIDENTAL_CODES.has(c.code));
  const byProduct = products.hasProducts;
  const chosen = byProduct
    ? (products.byId.get(productId)?.chargeCode ?? '')
    : code || (codes.some((c) => c.code === 'MISC') ? 'MISC' : codes[0]?.code) || '';
  const canPost = chosen.length > 0 && validAmount(amount);

  const post = useMutation({
    mutationFn: () =>
      api.addFolioLine(
        propertyId,
        row.reservationId,
        { chargeCode: chosen, amountMinor: parseMajorToMinor(amount.trim()) },
        opId,
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, row.reservationId] });
      onDone(
        isQueued(result)
          ? 'Request queued — will apply when the property is reachable.'
          : `Charge posted to ${guestName}.`,
      );
    },
    onError: (err) => setError(failureCopy(err, 'Could not post the charge.', fmt)),
  });

  return (
    <FormDialog
      title={`Post charge — ${guestName}`}
      onClose={onClose}
      actions={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            intent="primary"
            disabled={!canPost || post.isPending}
            onClick={() => {
              setError(null);
              post.mutate();
            }}
          >
            Post
          </Button>
        </>
      }
    >
      {products.query.isPending ? (
        <Skeleton aria-label="Loading products" />
      ) : byProduct ? (
        <>
          <Field
            label="Product"
            control={
              <NativeSelect
                value={productId}
                onChange={(e) => {
                  const item = products.byId.get(e.target.value);
                  setProductId(e.target.value);
                          if (item) setAmount(minorToMajorInput(item.defaultAmountMinor));
                }}
              >
                <option value="">Choose a product</option>
                {products.groups.map((g) => (
                  <optgroup key={g.category.categoryId} label={g.category.name}>
                    {g.items.map((i) => (
                      <option key={i.productId} value={i.productId}>
                        {i.name} · {money(i.defaultAmountMinor)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Amount"
            control={
              <Input placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            }
          />
        </>
      ) : codesQ.isError ? (
        <Alert>{failureCopy(codesQ.error, 'Could not load charge codes.', fmt)}</Alert>
      ) : !codesQ.isSuccess ? (
        <Skeleton aria-label="Loading charge codes" />
      ) : (
        <>
          {products.query.isError ? (
            <p className="muted">Products unavailable — posting by charge code.</p>
          ) : null}
          <Field
            label="Charge code"
            control={
              <NativeSelect value={chosen} onChange={(e) => setCode(e.target.value)}>
                {codes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Amount"
            control={
              <Input placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            }
          />
        </>
      )}
      {error ? <Alert>{error}</Alert> : null}
    </FormDialog>
  );
}
