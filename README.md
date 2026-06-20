# AIRagMessenger

[![Expo](https://img.shields.io/badge/Expo-54.0-blue?logo=expo&logoColor=white)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&logoColor=white)](https://reactnative.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-2.0-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Clerk](https://img.shields.io/badge/Clerk-Auth-6C47FF?logo=clerk&logoColor=white)](https://clerk.com/)
[![llama.rn](https://img.shields.io/badge/llama.rn-Local_AI-orange)](https://github.com/mybigday/llama.rn)

AIRagMessenger is an offline-first mobile chat app with private local AI and secure peer-to-peer offline mesh features. It stores messages locally in SQLite, syncs conversations through Supabase when online, and routes messages over Bluetooth Low Energy (BLE) and Wi-Fi Direct when offline. It authenticates users with Clerk, and can answer grounded questions about a chat by retrieving relevant messages and generating the answer on-device with Llama.

## Key Features

- **Offline-first messaging:** Messages are written to local SQLite immediately, then synced in the background.
- **P2P Offline Mesh Networking:** When completely disconnected, the app uses `@offline-protocol/mesh-sdk` to scan, discover, and deliver secure messages to nearby peers using Bluetooth Low Energy (BLE) and Wi-Fi Direct.
- **MLS Secure Sessions:** Integrates Message Layer Security (MLS) protocol to automatically establish end-to-end encrypted messaging sessions with local peers.
- **Cloud sync and realtime delivery:** Supabase stores synced conversations and messages, with realtime subscriptions for incoming chat updates.
- **Clerk authentication:** Clerk handles sign-in, sign-up, secure token caching, and Supabase JWT integration.
- **Local AI model management:** The Local AI settings screen downloads, deletes, and tests the on-device `Llama-3.2-1B-Instruct-Q4_K_M.gguf` model.
- **AI chat tools:** Generate summaries, reply suggestions, and grounded answers from inside a conversation.
- **RAG message search:** Supabase full-text search retrieves relevant synced messages, then the local Llama model answers using only those sources.
- **Mobile-native build:** The app uses native modules such as `expo-sqlite`, `expo-secure-store`, `llama.rn`, and native BLE capabilities, so it should be run as a dev build or native Android/iOS app.

## Architecture

The app follows an offline-first hybrid flow:

1. **Local storage first:** The React Native UI reads and writes chat data through local SQLite repositories.
2. **P2P Mesh routing (offline):** When peers are nearby and offline, messages are routed directly over Bluetooth/Wi-Fi Direct.
3. **Background cloud sync:** Background sync pushes pending local messages and pulls remote changes from Supabase once an internet connection is established.
4. **Supabase Realtime:** Supabase Realtime notifies active chats about newly inserted remote messages when online.
5. **Clerk Auth:** Clerk issues the `supabase` JWT used by the mobile app for authenticated Supabase access.
6. **Local RAG & Llama:** For "Ask about this chat", Supabase searches synced message text and the local Llama model generates a grounded answer with source messages.

See [docs/architecture.md](docs/architecture.md) for more detail.

## Quick Start

### Prerequisites

- Node.js 18 or newer
- npm
- Android Studio / Android SDK for native Android builds, or Xcode for iOS builds
- A Clerk application
- A Supabase project
- Optional: Ollama, only if you want to run the separate backend service

### Install

```bash
git clone https://github.com/Abhinov007/AI-Rag-Messenger.git
cd AI-Rag-Messenger
npm install
```

The optional backend has its own dependencies:

```bash
cd backend
npm install
```

### Environment

Copy the root example file and fill in your Clerk and Supabase values:

```bash
cp .env.example .env
```

Required mobile variables:

```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

If you run the optional backend, also copy `backend/.env.example` to `backend/.env`.

### Supabase Setup

1. Run `supabase.messages.sql` in the Supabase SQL editor to create the base chat schema and RLS policies.
2. Run `supabase/migrations/20260601_add_rag_message_search.sql` to add the message search vector, indexes, and `search_conversation_messages` RPC used by chat RAG.
3. In Clerk, create a JWT template named exactly `supabase` using Clerk's Supabase template.

### Run The App

Because the project uses `llama.rn`, use a native/dev-client build instead of Expo Go:

```bash
npm run android
```

or:

```bash
npm run ios
```

For an EAS preview Android APK:

```bash
eas build --profile preview --platform android
```

## Local AI

Open **Settings -> Local AI** in the app to download the local model. The app stores `Llama-3.2-1B-Instruct-Q4_K_M.gguf` in app document storage and shows download progress.

Once installed, the chat AI menu can:

- summarize recent messages
- suggest editable replies
- ask grounded questions about synced messages in the current chat

The RAG answer flow searches Supabase for relevant messages, but generation happens locally on the phone. Unsynced local-only messages are not available to the remote search RPC yet.

## Optional Backend

The `backend/` service still provides Ollama-backed endpoints:

- `GET /health`
- `GET /health/ollama`
- `POST /ai/summarize`
- `POST /ai/suggest-reply`

Start it with:

```bash
cd backend
npm run dev
```

See [backend/README.md](backend/README.md) for backend setup details.

## Documentation

- [Setup Guide](docs/setup.md)
- [Architecture](docs/architecture.md)
- [Database Schema](docs/database.md)
- [API Reference](docs/api.md)

## Tech Stack

- **Mobile:** Expo, React Native, TypeScript, React Navigation
- **Styling:** NativeWind / Tailwind CSS
- **Local storage:** Expo SQLite
- **Remote storage:** Supabase PostgreSQL, RLS, Realtime, RPC
- **Auth:** Clerk Expo
- **Offline Mesh:** `@offline-protocol/mesh-sdk` (P2P via BLE & Wi-Fi Direct), MLS session security
- **On-device AI:** `llama.rn`, Llama 3.2 1B GGUF
- **Optional AI backend:** Node.js, Express, Ollama

## Useful Commands

```bash
npm start
npm run android
npm run ios
npm run web
```

```bash
cd backend
npm run dev
```
