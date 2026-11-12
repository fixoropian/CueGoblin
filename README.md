# CueGoblin

CueGoblin is an open-source quick-capture app for thoughts and everyday tasks. Save text, voice or photos, then turn them into reminders, notes or lists, with optional AI using your own API key. Works offline-first, with privacy and user control at its core.

Built with React Native, Expo and TypeScript.

## What works today (milestone 1)

- **Fast capture** — type in the box at the top, pick Note / Task / Shopping, tap Add.
- **Browse** — filter the list by All, Notes, Tasks or Shopping.
- **Open and edit** — change the text, change the kind, tick a task off, or delete it (with a confirmation).
- **Offline first** — everything is saved on the device. No account, no network, no server.

Not built yet, and intentionally out of scope for now: voice capture, photos, reminders/notifications, search, backup and restore, offline transcription, AI, and any backend or analytics.

## Run it

You need [Node.js LTS](https://nodejs.org) and the **Expo Go** app on your phone (App Store / Play Store). This project uses Expo SDK 58, so make sure Expo Go is up to date — it only supports the newest SDK.

```bash
npm install
npx expo start
```

Then scan the QR code that appears in the terminal:

- **iPhone** — open the Camera app and tap the notification.
- **Android** — open Expo Go and use "Scan QR code".

Your phone and computer must be on the same Wi-Fi. If your network isolates devices, run `npx expo start --tunnel` instead.

While the dev server runs, saving a file reloads the app on your phone automatically. Press `w` in the terminal to try it in a browser as well.

Useful checks:

```bash
npm run typecheck   # TypeScript, no emit
npm run lint        # Expo's ESLint setup
npx expo-doctor     # dependency / config sanity check
```

## How it is organised

```
src/app/            screens (Expo Router: one file per route)
  _layout.tsx       providers + navigator
  index.tsx         capture box, filters, item list
  item/[id].tsx     one item: view, edit, delete
src/components/     CaptureBar, ItemRow, KindPicker, EmptyState
src/store/items.tsx in-memory items + every mutation, persisted on change
src/storage/items.ts AsyncStorage read/write (the only storage-aware file)
src/lib/            id generation and relative-time formatting
src/types.ts        the Item type and the three kinds
src/theme.ts        colours, spacing, radii, type styles
```

Three decisions worth knowing:

1. **Storage sits behind one module.** Items are a JSON array in AsyncStorage, which is plenty for a personal list. Because only `src/storage/items.ts` touches storage, moving to SQLite later is a single-file change.
2. **State is React Context + `useReducer`.** No state library. The reducer lists every possible change to the list, and saving happens in one effect after the first load.
3. **Saving on the detail screen is explicit.** Tap Save to keep the change, Cancel to discard. It is easier to reason about than autosave.

## Privacy

Everything stays on the device. There is no backend, no analytics and no telemetry. Nothing in this repo requires an API key today. If AI is added later, it will be opt-in and use a key the user supplies at runtime — keys will never be committed to the repository.

Storage is app-private but **not encrypted**, so it is fine for notes and shopping lists and not a place for passwords.

## Roadmap

- Milestone 1 — text capture, list, edit, organise (this release)
- Later — reminders/notifications, voice capture, photos, search
- Later — backup and restore, offline transcription
- Optional — AI tidy-up/summarising with the user's own provider key

Platform notes for those later milestones: notification behaviour differs between iOS and Android (Android channels, exact-alarm limits, battery optimisation), background audio recording and permissions differ on both, and offline transcription depends on on-device speech support that varies by OS version — so those features need real-device testing on both platforms.

## License

Not chosen yet. Add a LICENSE file before distributing this project.
