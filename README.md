# CueGoblin

CueGoblin is an open-source quick-capture app for thoughts and everyday tasks. Save text, voice or photos, then turn them into reminders, notes or lists, with optional AI using your own API key. Works offline-first, with privacy and user control at its core.

Built with React Native, Expo and TypeScript.

## What works today

- **Fast capture** — type in the box at the top, pick Note / Task / Shopping, tap Add.
- **Browse** — filter the list by All, Notes, Tasks or Shopping.
- **Open and edit** — change the text, change the kind, tick a task off, or delete it (with a confirmation).
- **Reminders** — pick a date and time on an item and CueGoblin schedules a local notification on the phone (see [Reminders need a development build](#reminders-need-a-development-build-not-expo-go)).
- **Backup and restore** — export every item to one JSON file, and restore from a file you choose. Nothing leaves the phone unless you move the file yourself.
- **Offline first** — everything is saved on the device. No account, no network, no server.

Not built yet, and intentionally out of scope for now: voice capture, photos, search, offline transcription, AI, cloud sync and any backend or analytics.

## Backup and restore

Both directions use the phone's own file picker, so CueGoblin never asks for storage permission and there is no cloud step.

**Export** writes everything to `cuegoblin-backup-YYYY-MM-DD-HHmmss.json` in a folder you choose. The file is plain JSON:

```json
{
  "format": "cuegoblin.backup",
  "version": 1,
  "exportedAt": 1795000000000,
  "items": [ /* the same records the app stores */ ]
}
```

**Restore** reads a file, checks every record before trusting any of it, and shows a preview: item counts by kind, how many reminders are still in the future, how many are past, and how many items on the phone would be replaced. Restoring is always **replace all** — there is no merge — and it asks for confirmation before touching anything.

What a restore does, in order, and why the order matters:

1. **Safety copy.** A timestamped copy of the current items and queued reminder IDs is written and then read back and compared. If it cannot be created or verified, the restore stops with your data and reminders untouched. Copies are never overwritten; the five most recent are kept, and only a restore that reaches the end tidies the older ones.
2. **Items.** The restored list is written and confirmed before any reminder is touched, so a failed write leaves the reminder queue exactly as it was.
3. **Reminders.** Reminders for the old and restored items are cancelled, then future reminder times are scheduled again. Past reminder times stay on the item as history, the same rule the editor uses.
4. **Report.** The result is either *restored*, *restored with reminder problems*, or *not restored*. A reminder that could not be scheduled or cancelled is listed by item; the app never calls a partly restored list a success.

A safety copy lives inside the app's private storage. The Backup screen can save the newest one to a folder you choose.

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

### Reminders need a development build, not Expo Go

Capture, browsing, editing and deleting work in Expo Go. **Reminders do not:** they need a development build of CueGoblin, because Expo Go is its own native app and does not use this project's notification configuration. Local reminders in Expo Go were never tested here, so do not rely on them.

With an Android device or emulator connected (Android Studio installed):

```bash
npx expo run:android
npx expo start --dev-client
```

On macOS with Xcode, use `npx expo run:ios` and then the same `npx expo start --dev-client`. The first build installs a CueGoblin app on the device; later JS changes still reload from the dev server.

Reminders have been checked on Android 15 (Samsung Galaxy A15). iOS reminder delivery has not been tested yet. Android may deliver a reminder a little late when the phone is in deep battery optimisation, and the notification permission prompt only appears once per install — if reminders stay silent, open Settings > Apps > CueGoblin > Notifications.

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
src/backup/         JSON backup format, restore sequence, safety copies, file access
src/lib/            id generation and relative-time formatting
src/notifications/  local reminder scheduling, permissions and Android channel
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
- Reminders — one local notification per item (added after milestone 1)
- Later — voice capture, photos, search
- Backup and restore — one JSON file, replace-all restore with a verified safety copy (added after reminders)
- Later — offline transcription
- Optional — AI tidy-up/summarising with the user's own provider key

Platform notes for those later milestones: notification behaviour differs between iOS and Android (Android channels, exact-alarm limits, battery optimisation), background audio recording and permissions differ on both, and offline transcription depends on on-device speech support that varies by OS version — so those features need real-device testing on both platforms.

## License

Not chosen yet. Add a LICENSE file before distributing this project.
