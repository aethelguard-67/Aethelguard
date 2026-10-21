create type public.account_role as enum ('admin', 'user');
create type public.file_status as enum ('blocked', 'released');
create type public.unquarantine_status as enum ('pending', 'approved', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role public.account_role not null default 'user',
  extension_active boolean not null default false,
  last_seen_at timestamptz
);

create table public.block_incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-fA-F]{64}$'),
  malicious_engines integer not null check (malicious_engines >= 0),
  total_engines integer not null check (total_engines >= malicious_engines),
  status public.file_status not null default 'blocked',
  blocked_at timestamptz not null default now()
);

create table public.unquarantine_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  incident_id uuid not null references public.block_incidents(id) on delete cascade,
  reason text not null,
  status public.unquarantine_status not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);

create index block_incidents_user_blocked_at_idx
  on public.block_incidents (user_id, blocked_at desc);
create index unquarantine_requests_status_requested_at_idx
  on public.unquarantine_requests (status, requested_at desc);
create unique index unquarantine_requests_one_pending_per_incident_idx
  on public.unquarantine_requests (incident_id) where status = 'pending';
create index profiles_active_last_seen_idx
  on public.profiles (last_seen_at desc) where extension_active;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

insert into public.profiles (id, email, display_name)
select
  id,
  coalesce(email, ''),
  coalesce(raw_user_meta_data ->> 'name', '')
from auth.users
on conflict (id) do nothing;

create function public.record_extension_heartbeat()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set extension_active = true, last_seen_at = now()
  where id = (select auth.uid());
  if not found then
    raise exception 'No profile exists for the authenticated user';
  end if;
end;
$$;

create function public.review_unquarantine_request(
  request_id uuid,
  decision public.unquarantine_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.unquarantine_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into request_row
  from public.unquarantine_requests
  where id = request_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Pending request not found';
  end if;

  update public.unquarantine_requests
  set status = decision, reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = request_row.id;

  if decision = 'approved' then
    update public.block_incidents
    set status = 'released'
    where id = request_row.incident_id and status = 'blocked';
    if not found then
      raise exception 'Incident is no longer blocked';
    end if;
  end if;
end;
$$;

revoke all on function public.record_extension_heartbeat() from public;
grant execute on function public.record_extension_heartbeat() to authenticated;
revoke all on function public.review_unquarantine_request(uuid, public.unquarantine_status) from public;
grant execute on function public.review_unquarantine_request(uuid, public.unquarantine_status) to authenticated;

alter table public.profiles enable row level security;
alter table public.block_incidents enable row level security;
alter table public.unquarantine_requests enable row level security;

create policy "Profiles are visible to the user and admins"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()));
create policy "Admins manage profiles"
  on public.profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Users and admins can view block incidents"
  on public.block_incidents for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));
create policy "Users and admins can view unquarantine requests"
  on public.unquarantine_requests for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));
create policy "Users can request release of their own blocked files"
  on public.unquarantine_requests for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.block_incidents
      where id = incident_id and user_id = (select auth.uid()) and status = 'blocked'
    )
  );

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.block_incidents to authenticated;
grant select, insert on public.unquarantine_requests to authenticated;

alter publication supabase_realtime add table public.unquarantine_requests;
alter publication supabase_realtime add table public.block_incidents;
alter publication supabase_realtime add table public.profiles;
