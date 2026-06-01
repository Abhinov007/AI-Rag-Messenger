# Setup Guide

Follow these steps to run AIRagMessenger locally.

AIRagMessenger is a native Expo/React Native app. Because it uses native modules such as `llama.rn`, `expo-sqlite`, and `expo-secure-store`, use a native/dev-client build instead of Expo Go.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer
- npm
- Android Studio / Android SDK for Android builds, or Xcode for iOS builds
- A [Clerk](https://clerk.com/) application
- A [Supabase](https://supabase.com/) project
- Optional: [EAS CLI](https://docs.expo.dev/build/introduction/) for cloud builds
- Optional: [Ollama](https://ollama.com/) only if you want to run the standalone `backend/` service

## 1. Install Dependencies

From the repository root:

```bash
npm install
```

The optional backend has its own dependencies:

```bash
cd backend
npm install
```

## 2. Supabase Setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run `supabase.messages.sql` from the repository root.
4. Apply the RAG search migration expected by the app:
   - `messages.search_vector`
   - `messages_search_vector_idx`
   - `messages_conversation_remote_id_idx`
   - `search_conversation_messages(...)`

Note: `supabase/migrations/20260601_add_rag_message_search.sql` currently lists the expected RAG artifacts rather than a complete SQL migration body. Before setting up a fresh Supabase project, replace it with the full SQL that creates the search vector, indexes, any trigger/backfill logic, and the `search_conversation_messages` RPC.

The current `supabase.messages.sql` enables RLS but uses open development policies. Tighten these policies before production.

## 3. Clerk Setup

1. Create a Clerk application.
2. In Clerk, configure email authentication for your app.
3. Go to **JWT Templates**.
4. Create a template named exactly `supabase`.
5. Use Clerk's Supabase template as the base.
6. Copy your Clerk publishable key.

The mobile app requests tokens with `getToken({ template: 'supabase' })`, so the template name must match exactly.

## 4. Mobile Environment

Create a root `.env` file from `.env.example`.

PowerShell:

```powershell
Copy-Item .env.example .env
```

Bash:

```bash
cp .env.example .env
```

Fill in:

```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

There is no active `EXPO_PUBLIC_AI_BACKEND_URL` setting in the mobile app right now. AI features use the on-device model through `llama.rn`.

## 5. Run The Mobile App

For Android:

```bash
npm run android
```

For iOS:

```bash
npm run ios
```

You can still start Metro manually:

```bash
npm start
```

But do not expect Expo Go to run the full app because `llama.rn` requires native build support.

For an EAS preview Android APK:

```bash
eas build --profile preview --platform android
```

## 6. Local AI Setup

After installing and opening the native app:

1. Sign in.
2. Open **Settings -> Local AI**.
3. Download the local model.
4. Wait for the download to finish.
5. Use **Test Local AI** to confirm generation works on the device.

The app downloads `Llama-3.2-1B-Instruct-Q4_K_M.gguf` into app document storage. The model is about 808 MB.

Once installed, the chat AI menu can:

- summarize recent messages
- suggest editable replies
- answer grounded questions about synced chat messages

## 7. Optional Backend Setup

The `backend/` folder is currently optional and not called by the mobile app. It exposes an Express/Ollama service for legacy or experimental server-side AI workflows.

Create `backend/.env` from `backend/.env.example`:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
```

Install and run Ollama:

```bash
ollama pull llama3.2
```

Start the backend:

```bash
cd backend
npm run dev
```

Available backend routes:

- `GET /health`
- `GET /health/ollama`
- `POST /ai/summarize`
- `POST /ai/suggest-reply`

## Troubleshooting

- **Missing Clerk key:** Ensure `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is set in the root `.env`.
- **Supabase sync fails:** Ensure the Clerk JWT template is named exactly `supabase`.
- **RAG search fails:** Confirm the `search_conversation_messages` RPC and `messages.search_vector` artifacts exist in Supabase.
- **Expo Go does not work:** Use `npm run android`, `npm run ios`, or an EAS/dev-client build because the app depends on native modules.
- **Local AI says model is missing:** Open **Settings -> Local AI** and download the model.
- **SQLite schema issues:** Clear app data during development after schema changes, or update `src/db/migrations.ts` carefully.
