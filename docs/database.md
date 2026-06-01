# Database Schema

AIRagMessenger uses two database layers:

- **Local SQLite:** The mobile app's source of truth for UI reads, offline writes, pagination, and sync state.
- **Supabase PostgreSQL:** Remote persistence for multi-device sync, realtime delivery, user lookup, and RAG message search.

The app writes locally first, then syncs local rows to Supabase when network/auth are available.

## Local SQLite

Local schema is created and migrated in `src/db/migrations.ts`.

### `conversations`

Stores local conversation metadata and remote sync state.

| Column | Type | Description |
| --- | --- | --- |
| `id` | INTEGER | Local primary key. |
| `title` | TEXT | Display title for the chat. |
| `last_message` | TEXT | Cached last message preview. |
| `remote_id` | TEXT | Supabase `conversations.id` UUID after sync. |
| `sync_error` | TEXT | Last sync error, if any. |
| `synced` | INTEGER | `0` pending/failed, `1` synced. |
| `owner_clerk_user_id` | TEXT | Clerk user ID for the local owner. |
| `contact_name` | TEXT | Display name of the other participant. |
| `contact_email` | TEXT | Email of the other participant. |
| `contact_normalized_email` | TEXT | Lowercase/trimmed email for lookup and uniqueness. |
| `contact_clerk_user_id` | TEXT | Clerk user ID of the other participant. |
| `participant_key` | TEXT | Stable shared key built from the two Clerk user IDs. |
| `created_at` | TEXT | ISO timestamp. |
| `updated_at` | TEXT | ISO timestamp. |
| `created_at_unix` | INTEGER | Sortable timestamp key. |
| `updated_at_unix` | INTEGER | Sortable timestamp key. |

Important local indexes include:

- `idx_conversations_owner_contact_email`
- `idx_conversations_participant_key`
- `idx_conversations_owner`
- `idx_conversations_contact_user`
- `idx_conversations_owner_updated_at_unix`
- `idx_conversations_contact_user_updated_at_unix`

### `messages`

Stores active local chat messages.

| Column | Type | Description |
| --- | --- | --- |
| `id` | INTEGER | Local primary key. |
| `conversation_id` | INTEGER | Local FK to `conversations.id`. |
| `sender_type` | TEXT | `user`, `assistant`, or `system`. |
| `sender_clerk_user_id` | TEXT | Clerk user ID of the sender when known. |
| `body` | TEXT | Message text. |
| `summary` | TEXT | Optional summary/AI metadata. |
| `remote_id` | TEXT | Supabase `messages.id` UUID after sync. |
| `sync_error` | TEXT | Last sync error, if any. |
| `synced` | INTEGER | `0` pending/failed, `1` synced. |
| `created_at` | TEXT | ISO timestamp. |
| `created_at_unix` | INTEGER | Sortable timestamp key. |

Important local indexes include:

- `idx_messages_remote_id`
- `idx_messages_sender_clerk_user_id`
- `idx_messages_conversation_created_at_unix`
- `idx_messages_conversation_created_at_unix_desc`
- `idx_messages_synced_created_at_unix`

### `messages_archive`

Stores archived/older local messages with the same core shape as `messages`. It supports local pagination and retention without losing older synced rows.

Important archive indexes include:

- `idx_messages_archive_remote_id`
- `idx_messages_archive_conversation_created_at_unix`
- `idx_messages_archive_conversation_created_at_unix_desc`

### `contacts`

Stores the current user's local contact list.

| Column | Type | Description |
| --- | --- | --- |
| `id` | INTEGER | Local primary key. |
| `clerk_user_id` | TEXT | Owner Clerk user ID. |
| `remote_id` | TEXT | Reserved for future remote contact sync. |
| `name` | TEXT | Contact display name. |
| `email` | TEXT | Contact email. |
| `normalized_email` | TEXT | Lowercase/trimmed email. |
| `synced` | INTEGER | Sync flag. |
| `sync_error` | TEXT | Last sync error, if any. |
| `created_at` | TEXT | ISO timestamp. |
| `updated_at` | TEXT | ISO timestamp. |

The table enforces `UNIQUE(clerk_user_id, normalized_email)`.

### `seed_history`

Tracks local seed runs by `seed_key` so starter data is not inserted repeatedly.

## Supabase PostgreSQL

Remote schema is defined in `supabase.messages.sql`.

### `app_users`

Directory table used for finding contacts by email.

| Column | Type | Description |
| --- | --- | --- |
| `clerk_user_id` | text | Primary key from Clerk. |
| `email` | text | User email. |
| `normalized_email` | text | Unique lowercase/trimmed email. |
| `display_name` | text | Optional profile display name. |
| `created_at` | timestamptz | Creation timestamp. |
| `updated_at` | timestamptz | Last update timestamp. |

### `conversations`

Remote shared conversation metadata.

| Column | Type | Description |
| --- | --- | --- |
| `id` | uuid | Remote primary key. |
| `clerk_user_id` | text | User that pushed/last synced the local row. |
| `local_id` | integer | Local SQLite conversation ID from the pushing device. |
| `title` | text | Conversation title. |
| `owner_clerk_user_id` | text | Conversation owner Clerk user ID. |
| `contact_clerk_user_id` | text | Other participant Clerk user ID. |
| `contact_name` | text | Other participant display name. |
| `contact_email` | text | Other participant email. |
| `contact_normalized_email` | text | Other participant normalized email. |
| `participant_key` | text | Unique shared key for both participants. |
| `created_at` | timestamptz | Creation timestamp. |
| `updated_at` | timestamptz | Last update timestamp. |

Important remote indexes include:

- `conversations_owner_updated_idx`
- `conversations_contact_updated_idx`
- `conversations_participant_key_idx`

### `messages`

Remote synced message history.

| Column | Type | Description |
| --- | --- | --- |
| `id` | uuid | Remote primary key. |
| `local_id` | integer | Local SQLite message ID from the sender's device. |
| `conversation_id` | integer | Local conversation ID retained for debug/backward compatibility. |
| `conversation_remote_id` | uuid | FK to Supabase `conversations.id`. |
| `clerk_user_id` | text | Clerk user ID of the user that synced the message. |
| `sender_type` | text | `user`, `assistant`, or `system`. |
| `body` | text | Message text. |
| `summary` | text | Optional summary/AI metadata. |
| `created_at` | timestamptz | Message timestamp. |
| `inserted_at` | timestamptz | Remote insert timestamp. |

Important remote indexes include:

- `messages_clerk_user_local_id_idx`
- `messages_conversation_remote_created_idx`
- `messages_clerk_user_conversation_id_idx`

## RAG Search Artifacts

The chat RAG flow expects Supabase to expose:

- `messages.search_vector`
- `messages_search_vector_idx`
- `messages_conversation_remote_id_idx`
- `search_conversation_messages(...)`

`searchConversationMessages` calls `search_conversation_messages` with:

- `p_conversation_remote_id`
- `p_question`
- `p_match_count`

The RPC should return message rows scoped to a single remote conversation, ranked by full-text relevance.

Note: `supabase/migrations/20260601_add_rag_message_search.sql` currently contains the expected artifact names rather than a complete SQL migration body. Before applying this migration in a fresh Supabase project, replace it with the full SQL that creates the search vector, indexes, trigger/backfill if needed, and RPC.

## Sync Mapping

| Local SQLite | Supabase | Notes |
| --- | --- | --- |
| `conversations.id` | `conversations.local_id` | Stored for sender-device traceability. |
| `conversations.remote_id` | `conversations.id` | Remote UUID saved locally after sync. |
| `conversations.participant_key` | `conversations.participant_key` | Unique shared conversation identity. |
| `messages.id` | `messages.local_id` | Combined with `clerk_user_id` for idempotent upsert. |
| `messages.remote_id` | `messages.id` | Remote UUID saved locally after sync. |
| `messages.conversation_id` | `messages.conversation_id` | Debug/backward compatibility local ID. |
| `conversations.remote_id` | `messages.conversation_remote_id` | Proper remote FK for synced messages. |

## Current RLS State

`supabase.messages.sql` enables RLS on:

- `app_users`
- `conversations`
- `messages`

However, the current policies are open development policies using `true` for access checks. They are useful for the current Expo + Clerk prototype, but they are not production-tight.

Before production, replace them with policies that enforce Clerk JWT claims, for example:

1. Users can only read/update their own `app_users` row.
2. Users can only read conversations where their Clerk user ID is `owner_clerk_user_id` or `contact_clerk_user_id`.
3. Users can only insert messages into conversations they participate in.
4. Users can only read messages for conversations they participate in.
