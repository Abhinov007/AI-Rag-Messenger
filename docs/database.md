# Database Schema

AIRagMessenger uses a dual-database strategy: **SQLite** for local storage and **Supabase (PostgreSQL)** for remote storage.

## Core Entities

### 1. Conversations
Stores the metadata for a chat between two users.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID / String | Local primary key |
| `remoteId` | UUID | Supabase ID (null if not synced) |
| `participant_key` | String | Unique hash of participants |
| `contact_email` | String | Email of the other participant |
| `contact_name` | String | Name of the other participant |
| `synced` | Boolean | Sync status |

### 2. Messages
Individual chat messages.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID / String | Local primary key |
| `remoteId` | UUID | Supabase ID |
| `conversation_id` | UUID | Reference to conversation |
| `content` | Text | Message body |
| `sender_id` | String | Clerk User ID of sender |
| `created_at` | ISO Date | Timestamp |
| `synced` | Boolean | Sync status |

### 3. Contacts
Cached contact information.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Local ID |
| `name` | String | Display name |
| `email` | String | Unique email |

## Local SQLite Tables

The local database is initialized in `src/db/database.ts` and managed through `src/db/migrations.ts`.

- `conversations`
- `messages`
- `contacts`
- `sync_metadata` (Reserved)

## Supabase Tables

Defined in `supabase.messages.sql`.

- `user_directory`: Public profiles for email lookup.
- `conversations`: Shared conversation records.
- `messages`: Message history with RLS enabled.

## Row Level Security (RLS)

Supabase RLS policies ensure:
1. Users can only see conversations where they are a participant.
2. Users can only see messages belonging to their conversations.
3. Users can only insert messages as themselves.
