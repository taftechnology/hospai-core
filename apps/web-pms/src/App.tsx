import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { shouldRetry, retryDelay } from '@hospai/client-core';
import { asClassified } from './client.js';
import { BookRoute } from './screens/BookRoute.js';
import { BoardScreen } from './screens/BoardScreen.js';
import { CheckInScreen } from './screens/CheckInScreen.js';
import { FolioScreen } from './screens/FolioScreen.js';
import { ShiftScreen } from './screens/ShiftScreen.js';
import { StaffRoute } from './screens/StaffRoute.js';
import { RosterRoute } from './screens/RosterRoute.js';
import { NightAuditRoute } from './screens/NightAuditRoute.js';
import { HousekeepingScreen } from './screens/HousekeepingScreen.js';
import { InventoryRoute } from './screens/InventoryRoute.js';
import { InventoryScreen } from './screens/InventoryScreen.js';
import { RatesRoute } from './screens/RatesRoute.js';
import { RatesScreen } from './screens/RatesScreen.js';
import { SettingsRoute } from './screens/SettingsRoute.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
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
            <Route path="book" element={<BookRoute />} />
            <Route path="inventory" element={<InventoryRoute />}>
              <Route index element={<InventoryScreen tab="types" />} />
              <Route path="rooms" element={<InventoryScreen tab="rooms" />} />
            </Route>
            <Route path="rates" element={<RatesRoute />}>
              <Route index element={<Navigate to="matrix" replace />} />
              <Route path="plans" element={<RatesScreen tab="plans" />} />
              <Route path="matrix" element={<RatesScreen tab="matrix" />} />
              <Route path="restrictions" element={<RatesScreen tab="restrictions" />} />
            </Route>
            <Route path="staff" element={<StaffRoute />} />
            <Route path="roster" element={<RosterRoute />} />
            <Route path="night-audit" element={<NightAuditRoute />} />
            <Route path="settings" element={<SettingsRoute />}>
              <Route index element={<Navigate to="property" replace />} />
              <Route path="property" element={<SettingsScreen tab="property" />} />
              <Route path="charges" element={<SettingsScreen tab="charges" />} />
              <Route path="tax" element={<SettingsScreen tab="tax" />} />
            </Route>
            <Route path="housekeeping/*" element={<HousekeepingScreen />} />
          </Route>
          <Route path="sign-in" element={<p className="main">Sign in required</p>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
