# Mobile app context

## What this app does
This Expo React Native app is the client for the Dhan trading workflow.
It lets users:
- register and log in
- view trading signals / notifications
- confirm or reject a signal
- see order placement status from the backend

It also lets admins:
- manage users
- create and cancel signals
- inspect signal progress and outcomes

## Main stack
- Expo Router for navigation
- React Native + TypeScript
- Expo Secure Store for auth persistence
- Expo Notifications for push notifications
- React Native Paper for UI components

## Dependency policy
- New Expo packages (e.g. `expo-file-system`, `expo-sharing`) may be added when needed,
  e.g. for downloading/saving/sharing exported files (admin excel reports).

## File downloads (admin excel exports)
- `mobile/services/api.ts` has a `downloadAndShareFile(path, filename)` helper that uses
  `File.downloadFileAsync` (expo-file-system's new `File`/`Paths` API, with an `Authorization`
  header) to download to `Paths.cache`, then opens the native share sheet via `expo-sharing`.
- `adminApi.exportUsers(...)` and `adminApi.exportOrders(...)` use this helper.

## Important architecture
- App entry / routing: mobile/app/
- Authentication provider: mobile/contexts/AuthContext.tsx
- API layer: mobile/services/api.ts
- Secure auth storage: mobile/services/auth.ts
- Push notification registration: mobile/services/notifications.ts
- Shared types: mobile/types/index.ts
- Theme constants: mobile/constants/theme.ts
- IST date/time helpers: mobile/utils/time.ts

## App structure
### Auth screens
- mobile/app/(auth)/login.tsx
- mobile/app/(auth)/register.tsx

### User screens
- mobile/app/(user)/index.tsx
  - shows incoming signals/notifications
  - confirm/reject actions
- mobile/app/(user)/orders.tsx
  - order-related history/status view
- mobile/app/(user)/profile.tsx
  - profile settings

### Admin screens
- mobile/app/(admin)/index.tsx
- mobile/app/(admin)/signals.tsx
  - has an "Export Report" button next to the date filter that downloads all orders (across signals) in that date range as an .xlsx file
- mobile/app/(admin)/signal-create.tsx
- mobile/app/(admin)/signal/[id].tsx
  - per-user status list; tap any row to open a detail modal (status, order ID, full error, IST timestamps, IPv6)
- mobile/app/(admin)/users.tsx
  - has an "Export" button that downloads the (filtered) users list as an .xlsx file
- mobile/app/(admin)/approvals.tsx
  - lists pending (`is_active=false`) sign-ups; admin can Approve (activates + assigns IPv6) or Reject (deletes)
- mobile/app/(admin)/user/[id].tsx

## How data flows
1. The app stores auth state in secure storage.
2. On startup, AuthContext restores the session and calls the backend /api/auth/me.
3. Screens call backend endpoints through the shared API helper in mobile/services/api.ts.
4. User actions like confirm/reject trigger backend-side order placement.

## Auth behavior
- Login saves the access token and user profile in secure storage.
- The app rehydrates auth on app launch.
- If the token is invalid or expired, the app clears stored auth.
- New registrations are pending until an admin approves them (see Approvals screen); login returns 403 "pending admin approval" until then.

## API base URL
The app uses:
- EXPO_PUBLIC_API_URL if set
- otherwise mobile/app.json extra.apiBaseUrl
- otherwise http://localhost:8000

## Useful run commands
From mobile/:
- npm install
- npm start
- npm run android

Build release APK (from mobile/android/):
```
$env:EXPO_PUBLIC_API_URL = "http://13.126.206.167"; .\gradlew assembleRelease
```

## Notes for future LLMs
- The mobile app is mostly a thin client; most business logic lives in the backend.
- The most important files for understanding user/admin workflows are:
  - mobile/services/api.ts
  - mobile/contexts/AuthContext.tsx
  - mobile/app/(user)/index.tsx
  - mobile/app/(admin)/signals.tsx

## Timestamp handling
- All backend timestamps are UTC naive ISO strings (no `Z` suffix).
- Use `formatDateTimeIST` or `formatDateIST` from `mobile/utils/time.ts` everywhere a date/time is shown.
- These helpers append `Z` before parsing so UTC is never misread as local time, then format in `Asia/Kolkata`.
- Do NOT use `new Date(...).toLocaleString()` directly in screens.

## Safe area handling
- Both tab layouts (`(admin)/_layout.tsx`, `(user)/_layout.tsx`) use `useSafeAreaInsets` to add `insets.bottom` to tab bar height and padding, covering devices with software navigation buttons.
- All screens use `SafeAreaView` from `react-native-safe-area-context` (NOT from `react-native`). The `react-native` one is iOS-only.
- Auth screens (`login.tsx`, `register.tsx`) wrap their `KeyboardAvoidingView` in `SafeAreaView` to handle the status bar.


aws command: aws s3 cp ".\app\build\outputs\apk\release\app-release.apk" "s3://apk-buket/app-release.apk" --content-type "application/vnd.android.package-archive"



cd mobile\scripts
.\release-apk.ps1 -Version 1.0.5