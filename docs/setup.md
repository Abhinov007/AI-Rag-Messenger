# Setup Guide

Follow these steps to get AIRagMessenger running locally.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer)
- [Expo Go](https://expo.dev/client) app on your physical device (for testing)
- [Ollama](https://ollama.com/) (for AI features)
- A [Clerk](https://clerk.com/) account
- A [Supabase](https://supabase.com/) project

## 1. Supabase Setup

1. Create a new project in Supabase.
2. Go to the **SQL Editor** and run the contents of `supabase.messages.sql` (found in the root directory). This sets up the tables and RLS policies.
3. Note your `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## 2. Clerk Setup

1. Create a new application in Clerk.
2. In the Clerk Dashboard, go to **JWT Templates**.
3. Create a new template named `supabase`.
4. Use the default Supabase template provided by Clerk.
5. Note your `CLERK_PUBLISHABLE_KEY`.

## 3. Environment Variables

### Mobile App
Create a `.env` file in the root directory:

```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
# Optional: Point to your backend IP if testing on a physical device
EXPO_PUBLIC_AI_BACKEND_URL=http://your-computer-ip:3000
```

### AI Backend
Create a `.env` file in the `backend/` directory:

```env
PORT=3000
OLLAMA_HOST=http://127.0.0.1:11434
```

## 4. Install & Run AI Backend

1. **Pull the LLM:**
   ```bash
   ollama pull llama3.2
   ```
2. **Install Dependencies:**
   ```bash
   cd backend
   npm install
   ```
3. **Start the Backend:**
   ```bash
   npm run dev
   ```

## 5. Install & Run Mobile App

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Start Expo:**
   ```bash
   npm start
   ```
3. Scan the QR code with your **Expo Go** app (Android) or **Camera app** (iOS).

## Troubleshooting

- **Sync not working:** Ensure your Clerk JWT template is named exactly `supabase`.
- **Backend unreachable:** If using a physical device, use your computer's local IP address (e.g., `192.168.1.x`) instead of `localhost` in the `.env` file.
- **SQLite Errors:** If you make schema changes, you may need to increment the migration version in `src/db/migrations.ts` or clear the app data.
