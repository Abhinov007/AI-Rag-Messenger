# API Reference

AIRagMessenger currently has two API surfaces:

1. **Active mobile runtime API:** Supabase tables, Realtime, and the `search_conversation_messages` RPC.
2. **Optional backend API:** The standalone `backend/` Express service that talks to Ollama. The mobile app does not currently call this backend.

## Active Mobile API: Supabase

The mobile app creates an authenticated Supabase client with a Clerk token from the JWT template named `supabase`.

### Tables Used By The App

- `app_users`
- `conversations`
- `messages`

See `docs/database.md` for full table fields and sync mappings.

### Realtime

The app subscribes to inserts on the `messages` table for the active remote conversation.

Conceptually:

```ts
supabase
  .channel(`messages:${remoteConversationId}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_remote_id=eq.${remoteConversationId}`,
    },
    handleMessageInsert,
  )
  .subscribe();
```

Incoming remote messages are saved into local SQLite before the UI refreshes.

### RAG Search RPC

`searchConversationMessages` calls the Supabase RPC `search_conversation_messages`.

```ts
supabase.rpc('search_conversation_messages', {
  p_conversation_remote_id: remoteConversationId,
  p_question: retrievalSearchText,
  p_match_count: matchCount,
});
```

#### Request Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `p_conversation_remote_id` | uuid | Supabase `conversations.id` for the current chat. |
| `p_question` | text | Search text derived from the user's question. |
| `p_match_count` | integer | Maximum number of matching messages to return. Defaults to `8` in the app. |

#### Expected Response Rows

| Field | Type | Description |
| --- | --- | --- |
| `id` | uuid | Supabase message ID. |
| `conversation_remote_id` | uuid | Remote conversation ID. |
| `clerk_user_id` | text | Sender/syncing Clerk user ID. |
| `sender_type` | text | `user`, `assistant`, or `system`. |
| `body` | text | Message text. |
| `created_at` | timestamptz | Message timestamp. |
| `rank` | number | Full-text search relevance rank. |

The mobile app passes these retrieved rows into the on-device Llama answer-generation flow. Generation does not happen in Supabase.

## Optional Backend API

The `backend/` folder contains a standalone Express service for Ollama-backed summary and reply-suggestion experiments. It type-checks and can run independently, but the current mobile app has no backend URL config and no HTTP calls to these routes.

### Base URL

Default:

```text
http://127.0.0.1:8000
```

Configured by:

```env
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
```

### `GET /health`

Checks whether the Express service is running.

#### Response

```json
{
  "ok": true,
  "service": "airagmessenger-backend"
}
```

### `GET /health/ollama`

Checks whether Ollama is reachable through `OLLAMA_BASE_URL`.

#### Success Response

```json
{
  "ok": true,
  "provider": "ollama",
  "model": "llama3.2"
}
```

#### Error Response

Status: `503`

```json
{
  "detail": "Ollama health check failed with status 500"
}
```

### Shared AI Request Payload

Both optional AI POST routes expect this shape:

```json
{
  "conversationId": 42,
  "title": "Maa",
  "messages": [
    {
      "sender": "user",
      "body": "Did you watch the match?",
      "createdAt": "2026-06-01T10:30:00.000Z"
    },
    {
      "sender": "other",
      "body": "Yes, Arsenal played well.",
      "createdAt": "2026-06-01T10:31:00.000Z"
    }
  ]
}
```

Allowed `sender` values:

- `user`
- `assistant`
- `system`
- `other`

Invalid payloads return:

Status: `422`

```json
{
  "detail": "Invalid summarize payload."
}
```

or:

```json
{
  "detail": "Invalid suggest-reply payload."
}
```

### `POST /ai/summarize`

Generates a concise summary using Ollama.

#### Success Response

```json
{
  "summary": "The conversation was about watching the match and Arsenal playing well."
}
```

#### Error Response

Status: `503`

```json
{
  "detail": "Summarization failed."
}
```

### `POST /ai/suggest-reply`

Generates exactly three reply suggestions using Ollama.

#### Success Response

```json
{
  "suggestions": [
    "Yes, they looked sharp today.",
    "Which player impressed you most?",
    "I missed it, tell me the score."
  ]
}
```

#### Error Response

Status: `503`

```json
{
  "detail": "Reply suggestion failed."
}
```

## Notes

- The main app's current summary, reply suggestion, and RAG answer generation run on-device through `llama.rn`.
- The optional backend calls Ollama's `/api/tags` and `/api/generate` endpoints.
- The optional backend does not implement chat RAG.
- Tighten Supabase RLS policies before production; the current SQL uses development-friendly policies.
