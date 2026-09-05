import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { PermissionRoute } from './auth/PermissionRoute.js';
import { createQueryClient } from './query-client.js';
import { BookingScreen } from './screens/BookingScreen.js';
import { BoardScreen } from './screens/BoardScreen.js';
import { TapeChartScreen } from './screens/TapeChartScreen.js';
import { ReservationsDirectoryScreen } from './screens/ReservationsDirectoryScreen.js';
import { CheckInScreen } from './screens/CheckInScreen.js';
import { FolioScreen } from './screens/FolioScreen.js';
import { ShiftScreen } from './screens/ShiftScreen.js';
import { StaffScreen } from './screens/StaffScreen.js';
import { RosterScreen } from './screens/RosterScreen.js';
import { NightAuditScreen } from './screens/NightAuditScreen.js';
import { ExceptionsScreen } from './screens/ExceptionsScreen.js';
import { GuestsDirectoryScreen } from './screens/GuestsDirectoryScreen.js';
import { GuestProfileScreen } from './screens/GuestProfileScreen.js';
import { HousekeepingScreen } from './screens/HousekeepingScreen.js';
import { InventoryScreen } from './screens/InventoryScreen.js';
import { RatesScreen } from './screens/RatesScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { CityLedgerScreen } from './screens/CityLedgerScreen.js';
import { SignInScreen } from './screens/SignInScreen.js';
import { AppShell } from './shell/AppShell.js';
import { ClerkSignedInGate } from './providers/ClerkSignedInGate.js';
import { UiGallery } from './dev/UiGallery.js';

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
              <Route index element={<InventoryScreen tab="types" />} />
              <Route path="rooms" element={<InventoryScreen tab="rooms" />} />
            </Route>
            <Route path="rates" element={<PermissionRoute permission="rates:write" />}>
              <Route index element={<Navigate to="matrix" replace />} />
              <Route path="plans" element={<RatesScreen tab="plans" />} />
              <Route path="matrix" element={<RatesScreen tab="matrix" />} />
              <Route path="restrictions" element={<RatesScreen tab="restrictions" />} />
            </Route>
            <Route path="staff" element={<PermissionRoute permission="staff:read" />}>
              <Route index element={<StaffScreen />} />
            </Route>
            <Route path="roster" element={<PermissionRoute permission="roster:read" />}>
              <Route index element={<RosterScreen />} />
            </Route>
            <Route path="city-ledger" element={<CityLedgerScreen />} />
            <Route path="city-ledger/:accountId" element={<CityLedgerScreen />} />
            <Route path="night-audit" element={<PermissionRoute permission="night_audit:run" />}>
              <Route index element={<NightAuditScreen />} />
            </Route>
            <Route path="exceptions" element={<ExceptionsScreen />} />
            <Route path="settings" element={<PermissionRoute permission="settings:configure" />}>
              <Route index element={<Navigate to="property" replace />} />
              <Route path="property" element={<SettingsScreen tab="property" />} />
              <Route path="charges" element={<SettingsScreen tab="charges" />} />
              <Route path="tax" element={<SettingsScreen tab="tax" />} />
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
