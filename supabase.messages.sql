-- Run this entire file in Supabase Dashboard -> SQL Editor.
-- It defines the remote schema expected by the current mobile app.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  clerk_user_id text primary key,
  email text not null,
  normalized_email text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text,
  local_id integer,
  title text,
  owner_clerk_user_id text,
  contact_clerk_user_id text,
  contact_name text,
  contact_email text,
  contact_normalized_email text,
  participant_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  local_id integer not null,
  conversation_id integer not null,
  conversation_remote_id uuid references public.conversations(id) on delete cascade,
  clerk_user_id text not null,
  sender_type text not null check (sender_type in ('user', 'assistant', 'system')),
  body text not null,
  summary text,
  created_at timestamptz not null default now(),
  inserted_at timestamptz not null default now()
);

alter table public.messages
add column if not exists conversation_remote_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_conversation_remote_id_fkey'
  ) then
    alter table public.messages
    add constraint messages_conversation_remote_id_fkey
    foreign key (conversation_remote_id)
    references public.conversations(id)
    on delete cascade;
  end if;
end $$;

create unique index if not exists messages_clerk_user_local_id_idx
on public.messages (clerk_user_id, local_id);

create index if not exists conversations_owner_updated_idx
on public.conversations (owner_clerk_user_id, updated_at desc);

create index if not exists conversations_contact_updated_idx
on public.conversations (contact_clerk_user_id, updated_at desc);

create index if not exists conversations_participant_key_idx
on public.conversations (participant_key);

create index if not exists messages_conversation_remote_created_idx
on public.messages (conversation_remote_id, created_at asc);

create index if not exists messages_clerk_user_conversation_id_idx
on public.messages (clerk_user_id, conversation_id);

alter table public.app_users enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.app_users to anon, authenticated;
grant select, insert, update on public.conversations to anon, authenticated;
grant select, insert on public.messages to anon, authenticated;

drop policy if exists "app users open access" on public.app_users;
drop policy if exists "conversations open access" on public.conversations;
drop policy if exists "messages open access" on public.messages;
drop policy if exists "messages insert for app clients" on public.messages;
drop policy if exists "messages select for app clients" on public.messages;

-- Development policies for the current Expo + Clerk prototype.
-- Tighten these once Clerk JWT claims are fully enforced by Supabase.
create policy "app users open access"
on public.app_users
for all
to anon, authenticated
using (true)
with check (true);

create policy "conversations open access"
on public.conversations
for all
to anon, authenticated
using (true)
with check (true);

create policy "messages open access"
on public.messages
for all
to anon, authenticated
using (true)
with check (true);
