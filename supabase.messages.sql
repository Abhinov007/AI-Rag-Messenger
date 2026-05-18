-- Run this entire file in Supabase Dashboard → SQL Editor (on your project).
-- RLS blocks all access by default until policies exist.

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

alter table public.messages enable row level security;

-- Table-level grants (RLS policies still apply on top of these)
grant usage on schema public to anon, authenticated;
grant select, insert on public.messages to anon, authenticated;

-- Remove old / conflicting policies
drop policy if exists "anon can insert messages" on public.messages;
drop policy if exists "anon can read messages" on public.messages;
drop policy if exists "authenticated can insert messages" on public.messages;
drop policy if exists "authenticated can read messages" on public.messages;
drop policy if exists "messages insert for app clients" on public.messages;
drop policy if exists "messages select for app clients" on public.messages;

-- Expo app uses EXPO_PUBLIC_SUPABASE_ANON_KEY → requests run as role `anon`.
-- `.insert().select('id')` needs both INSERT and SELECT policies.
create policy "messages insert for app clients"
on public.messages
for insert
to anon, authenticated
with check (true);

create policy "messages select for app clients"
on public.messages
for select
to anon, authenticated
using (true);

-- Optional: tighten later when Clerk JWT is wired into Supabase (Third-Party Auth).
-- Example (uncomment after Clerk ↔ Supabase integration):
-- create policy "users insert own messages"
-- on public.messages for insert to authenticated
-- with check (clerk_user_id = (auth.jwt() ->> 'sub'));
-- create policy "users read own messages"
-- on public.messages for select to authenticated
-- using (clerk_user_id = (auth.jwt() ->> 'sub'));
