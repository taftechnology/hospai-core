import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

export type BandSpec = {
  intent: 'exception' | 'attention' | 'informational';
  message: string;
  link?: { to: string; label: string };
  testId: string;
  role?: 'status' | 'alert';
};

type Registered = BandSpec & { order: number };

type BandApi = {
  register: (id: string, spec: BandSpec) => void;
  unregister: (id: string) => void;
};

const BandApiContext = createContext<BandApi | null>(null);
const BandSpecsContext = createContext<ReadonlyMap<string, Registered>>(new Map());

const BAND_CLASS: Record<BandSpec['intent'], string> = {
  exception: 'band band--exception',
  attention: 'band band--attention',
  informational: 'band band--informational',
};

function sameSpec(a: BandSpec, b: BandSpec): boolean {
  return (
    a.intent === b.intent &&
    a.message === b.message &&
    a.testId === b.testId &&
    a.role === b.role &&
    a.link?.to === b.link?.to &&
    a.link?.label === b.link?.label
  );
}

export function BandProvider({ children }: { children: ReactNode }) {
  const [specs, setSpecs] = useState<Map<string, Registered>>(() => new Map());
  const orderRef = useRef(0);
  const ordersRef = useRef(new Map<string, number>());

  const api = useMemo<BandApi>(() => {
    return {
      register(id, spec) {
        let order = ordersRef.current.get(id);
        if (order === undefined) {
          order = orderRef.current;
          orderRef.current += 1;
          ordersRef.current.set(id, order);
        }
        setSpecs((prev) => {
          const existing = prev.get(id);
          if (existing && sameSpec(existing, spec) && existing.order === order) return prev;
          const next = new Map(prev);
          next.set(id, { ...spec, order });
          return next;
        });
      },
      unregister(id) {
        setSpecs((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      },
    };
  }, []);

  return (
    <BandApiContext.Provider value={api}>
      <BandSpecsContext.Provider value={specs}>{children}</BandSpecsContext.Provider>
    </BandApiContext.Provider>
  );
}

export function useBand(id: string, spec: BandSpec | null): void {
  const ctx = useContext(BandApiContext);
  const intent = spec?.intent;
  const message = spec?.message;
  const linkTo = spec?.link?.to;
  const linkLabel = spec?.link?.label;
  const testId = spec?.testId;
  const role = spec?.role;

  useEffect(() => {
    if (!ctx) return;
    if (intent === undefined || message === undefined || testId === undefined) {
      ctx.unregister(id);
      return () => ctx.unregister(id);
    }
    const next: BandSpec = {
      intent,
      message,
      testId,
      ...(role ? { role } : {}),
      ...(linkTo !== undefined && linkLabel !== undefined
        ? { link: { to: linkTo, label: linkLabel } }
        : {}),
    };
    ctx.register(id, next);
    return () => ctx.unregister(id);
  }, [ctx, id, intent, message, linkTo, linkLabel, testId, role]);
}

function highest(specs: ReadonlyMap<string, Registered>): Registered | null {
  let best: Registered | null = null;
  for (const spec of specs.values()) {
    if (!best) {
      best = spec;
      continue;
    }
    const rank = { exception: 0, attention: 1, informational: 2 };
    const byIntent = rank[spec.intent] - rank[best.intent];
    if (byIntent < 0 || (byIntent === 0 && spec.order < best.order)) best = spec;
  }
  return best;
}

export function BandHost() {
  const api = useContext(BandApiContext);
  const specs = useContext(BandSpecsContext);
  const spec = api ? highest(specs) : null;
  if (!spec) return null;
  return (
    <div className={BAND_CLASS[spec.intent]} role={spec.role ?? 'status'} data-testid={spec.testId}>
      <span>{spec.message}</span>
      {spec.link ? <Link to={spec.link.to}>{spec.link.label}</Link> : null}
    </div>
  );
}
