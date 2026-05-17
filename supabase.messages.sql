create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  local_id integer not null,
  conversation_id integer not null,
  clerk_user_id text not null,
  sender_type text not null check (sender_type in ('user', 'assistant', 'system')),
  body text not null,
  summary text,
  created_at timestamptz not null default now(),
  inserted_at timestamptz not null default now()
);

create unique index if not exists messages_clerk_user_local_id_idx
on public.messages (clerk_user_id, local_id);

create index if not exists messages_clerk_user_conversation_id_idx
on public.messages (clerk_user_id, conversation_id);
