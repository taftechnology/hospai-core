import { createContext, useContext, type ReactNode } from 'react';
import type { MeView } from '../api/hooks.js';

const OperatorContext = createContext<MeView | null>(null);

export function OperatorProvider({ operator, children }: { operator: MeView; children: ReactNode }) {
  return <OperatorContext.Provider value={operator}>{children}</OperatorContext.Provider>;
}

export function useOperator(): MeView {
  const v = useContext(OperatorContext);
  if (!v) throw new Error('operator_context_missing');
  return v;
}

/** Viewers read; only ops_admin sees write buttons and the Operators screen. */
export function useIsAdmin(): boolean {
  return useOperator().role === 'ops_admin';
}
