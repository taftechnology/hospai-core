import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Skeleton } from '@hospai/ui-kit';
import { PermissionRoute } from './auth/PermissionRoute.js';
import { createQueryClient } from './query-client.js';
import { BookingScreen } from './screens/BookingScreen.js';
import { BoardScreen } from './screens/BoardScreen.js';
import { TapeChartScreen } from './screens/TapeChartScreen.js';
import { ReservationsDirectoryScreen } from './screens/ReservationsDirectoryScreen.js';
import { CheckInScreen } from './screens/CheckInScreen.js';
import { FolioScreen } from './screens/FolioScreen.js';
import { ShiftScreen } from './screens/ShiftScreen.js';
import { GuestsDirectoryScreen } from './screens/GuestsDirectoryScreen.js';
import { GuestProfileScreen } from './screens/GuestProfileScreen.js';
import { HousekeepingScreen } from './screens/HousekeepingScreen.js';
import { CityLedgerScreen } from './screens/CityLedgerScreen.js';
import { SignInScreen } from './screens/SignInScreen.js';
import { AppShell } from './shell/AppShell.js';
import { ClerkSignedInGate } from './providers/ClerkSignedInGate.js';
import { UiGallery } from './dev/UiGallery.js';

const SettingsScreen = lazy(() =>
  import('./screens/SettingsScreen.js').then((m) => ({ default: m.SettingsScreen })),
);
const RatesScreen = lazy(() =>
  import('./screens/RatesScreen.js').then((m) => ({ default: m.RatesScreen })),
);
const InventoryScreen = lazy(() =>
  import('./screens/InventoryScreen.js').then((m) => ({ default: m.InventoryScreen })),
);
const StaffScreen = lazy(() =>
  import('./screens/StaffScreen.js').then((m) => ({ default: m.StaffScreen })),
);
const RosterScreen = lazy(() =>
  import('./screens/RosterScreen.js').then((m) => ({ default: m.RosterScreen })),
);
const ExceptionsScreen = lazy(() =>
  import('./screens/ExceptionsScreen.js').then((m) => ({ default: m.ExceptionsScreen })),
);
const NightAuditScreen = lazy(() =>
  import('./screens/NightAuditScreen.js').then((m) => ({ default: m.NightAuditScreen })),
);

const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<ClerkSignedInGate><AppShell /></ClerkSignedInGate>}>
            <Route index element={<Navigate to="/board" replace />} />
            <Route path="board" element={<TapeChartScreen />} />
            <Route path="arrivals" element={<BoardScreen mode="arrivals" />} />
            <Route path="departures" element={<BoardScreen mode="departures" />} />
            <Route path="in-house" element={<BoardScreen mode="in-house" />} />
            <Route path="reservations" element={<ReservationsDirectoryScreen />} />
            <Route path="guests" element={<GuestsDirectoryScreen />} />
            <Route path="guests/:guestRef" element={<GuestProfileScreen />} />
            <Route path="check-in/:reservationId" element={<CheckInScreen />} />
            <Route path="folio/:reservationId" element={<FolioScreen />} />
            <Route path="shift" element={<ShiftScreen />} />
            <Route path="shift/:shiftId" element={<ShiftScreen />} />
            <Route path="book" element={<PermissionRoute permission="reservations:write" />}>
              <Route index element={<BookingScreen />} />
            </Route>
            <Route path="inventory" element={<PermissionRoute permission="inventory:write" />}>
              <Route index element={
                <Suspense fallback={<Skeleton />}>
                  <InventoryScreen tab="types" />
                </Suspense>
              } />
              <Route path="rooms" element={
                <Suspense fallback={<Skeleton />}>
                  <InventoryScreen tab="rooms" />
                </Suspense>
              } />
            </Route>
            <Route path="rates" element={<PermissionRoute permission="rates:write" />}>
              <Route index element={<Navigate to="matrix" replace />} />
              <Route path="plans" element={
                <Suspense fallback={<Skeleton />}>
                  <RatesScreen tab="plans" />
                </Suspense>
              } />
              <Route path="matrix" element={
                <Suspense fallback={<Skeleton />}>
                  <RatesScreen tab="matrix" />
                </Suspense>
              } />
              <Route path="restrictions" element={
                <Suspense fallback={<Skeleton />}>
                  <RatesScreen tab="restrictions" />
                </Suspense>
              } />
            </Route>
            <Route path="staff" element={<PermissionRoute permission="staff:read" />}>
              <Route index element={
                <Suspense fallback={<Skeleton />}>
                  <StaffScreen />
                </Suspense>
              } />
            </Route>
            <Route path="roster" element={<PermissionRoute permission="roster:read" />}>
              <Route index element={
                <Suspense fallback={<Skeleton />}>
                  <RosterScreen />
                </Suspense>
              } />
            </Route>
            <Route path="city-ledger" element={<CityLedgerScreen />} />
            <Route path="city-ledger/:accountId" element={<CityLedgerScreen />} />
            <Route path="night-audit" element={<PermissionRoute permission="night_audit:run" />}>
              <Route index element={
                <Suspense fallback={<Skeleton />}>
                  <NightAuditScreen />
                </Suspense>
              } />
            </Route>
            <Route path="exceptions" element={
              <Suspense fallback={<Skeleton />}>
                <ExceptionsScreen />
              </Suspense>
            } />
            <Route path="settings" element={<PermissionRoute permission="settings:configure" />}>
              <Route index element={<Navigate to="property" replace />} />
              <Route path="property" element={
                <Suspense fallback={<Skeleton />}>
                  <SettingsScreen tab="property" />
                </Suspense>
              } />
              <Route path="charges" element={
                <Suspense fallback={<Skeleton />}>
                  <SettingsScreen tab="charges" />
                </Suspense>
              } />
              <Route path="tax" element={
                <Suspense fallback={<Skeleton />}>
                  <SettingsScreen tab="tax" />
                </Suspense>
              } />
            </Route>
            <Route path="housekeeping/*" element={<PermissionRoute permission="housekeeping:read" />}>
              <Route path="*" element={<HousekeepingScreen />} />
            </Route>
          </Route>
          <Route path="sign-in" element={<SignInScreen />} />
          {import.meta.env.DEV ? (
            <Route path="dev/ui" element={<UiGallery />} />
          ) : null}
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
