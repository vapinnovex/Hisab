# Hishob mobile

React Native + Expo SDK 57 + TypeScript. This app uses React Navigation native-stack and bottom tabs (`App.tsx`), with screens in `src/screens`; it does not use Expo Router.

- Read version-matched Expo documentation before changing native module usage.
- Install Expo/native dependencies with `npx expo install` and keep `expo-doctor` passing.
- Auth tokens belong in `src/storage.ts` (SecureStore on native; HttpOnly same-origin cookie on web, never a browser-stored JWT).
- Do not put authorization decisions in the UI; shop access is validated by the backend.
- Keep API transport in `src/api.ts` and session handling in `src/auth.tsx`.
- Run `npm run typecheck`, `npm run lint`, and `npm run format:check` after changes.
- Run `npm run test:e2e` for workflow changes, with MongoDB on port 27018 and the backend virtualenv installed.
- Do not create or edit generated `ios/` or `android/` trees by hand. Configure native behavior in `app.json` and config plugins.
