import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthGate } from './auth/AuthGate.js';
import { CreateCustomerScreen } from './screens/CreateCustomerScreen.js';
import { CustomerDetailScreen } from './screens/CustomerDetailScreen.js';
import { CustomersScreen } from './screens/CustomersScreen.js';
import { OperatorLogScreen } from './screens/OperatorLogScreen.js';
import { OperatorsScreen } from './screens/OperatorsScreen.js';
import { PropertyHealthScreen } from './screens/PropertyHealthScreen.js';
import { Shell } from './shell.js';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false } },
  });
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/customers" replace />} />
        <Route path="/customers" element={<CustomersScreen />} />
        <Route path="/customers/new" element={<CreateCustomerScreen />} />
        <Route path="/customers/:orgId" element={<CustomerDetailScreen />} />
        <Route path="/customers/:orgId/hotels/:propertyId" element={<PropertyHealthScreen />} />
        <Route path="/operator-log" element={<OperatorLogScreen />} />
        <Route path="/operators" element={<OperatorsScreen />} />
        <Route path="*" element={<Navigate to="/customers" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <AuthGate>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  );
}
