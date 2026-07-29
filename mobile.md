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

## Important architecture
- App entry / routing: mobile/app/
- Authentication provider: mobile/contexts/AuthContext.tsx
- API layer: mobile/services/api.ts
- Secure auth storage: mobile/services/auth.ts
- Push notification registration: mobile/services/notifications.ts
- Shared types: mobile/types/index.ts
- Theme constants: mobile/constants/theme.ts

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
- mobile/app/(admin)/signal-create.tsx
- mobile/app/(admin)/signal/[id].tsx
- mobile/app/(admin)/users.tsx
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

## Notes for future LLMs
- The mobile app is mostly a thin client; most business logic lives in the backend.
- The most important files for understanding user/admin workflows are:
  - mobile/services/api.ts
  - mobile/contexts/AuthContext.tsx
  - mobile/app/(user)/index.tsx
  - mobile/app/(admin)/signals.tsx
