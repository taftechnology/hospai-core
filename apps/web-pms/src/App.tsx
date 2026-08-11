import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { shouldRetry, retryDelay } from '@hospai/client-core';
import { asClassified } from './client.js';
import { BoardScreen } from './screens/BoardScreen.js';
import { CheckInScreen } from './screens/CheckInScreen.js';
import { FolioScreen } from './screens/FolioScreen.js';
import { ShiftScreen } from './screens/ShiftScreen.js';
import { StaffRoute } from './screens/StaffRoute.js';
import { AppShell } from './shell/AppShell.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => shouldRetry(asClassified(err)) && count < 3,
      retryDelay: (count, err) => retryDelay(asClassified(err), count),
    },
    mutations: { retry: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/arrivals" replace />} />
            <Route path="arrivals" element={<BoardScreen mode="arrivals" />} />
            <Route path="departures" element={<BoardScreen mode="departures" />} />
            <Route path="in-house" element={<BoardScreen mode="in-house" />} />
            <Route path="check-in/:reservationId" element={<CheckInScreen />} />
            <Route path="folio/:reservationId" element={<FolioScreen />} />
            <Route path="shift" element={<ShiftScreen />} />
            <Route path="shift/:shiftId" element={<ShiftScreen />} />
            <Route path="staff" element={<StaffRoute />} />
          </Route>
          <Route path="sign-in" element={<p className="main">Sign in required</p>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
