-- Push notification subscriptions for Training Hub
-- Run in Supabase SQL Editor

create table if not exists push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- Allow anon access (single-user app)
alter table push_subscriptions enable row level security;
create policy "Allow all access to push_subscriptions" on push_subscriptions for all using (true) with check (true);
