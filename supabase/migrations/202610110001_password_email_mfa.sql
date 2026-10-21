create table public.email_mfa_challenges (
  session_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_hash text not null check (challenge_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table public.email_mfa_verified_sessions (
  session_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.email_mfa_challenges enable row level security;
alter table public.email_mfa_verified_sessions enable row level security;
revoke all on public.email_mfa_challenges, public.email_mfa_verified_sessions from public, anon, authenticated;
grant all on public.email_mfa_challenges, public.email_mfa_verified_sessions to service_role;

create or replace function public.issue_email_mfa_challenge(
  p_session_id uuid,
  p_user_id uuid,
  p_challenge_hash text,
  p_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  issued boolean := false;
begin
  insert into public.email_mfa_challenges (
    session_id, user_id, challenge_hash, code_hash, attempts, created_at, last_sent_at, expires_at, consumed_at
  )
  values (
    p_session_id, p_user_id, p_challenge_hash, p_code_hash, 0, now(), now(), now() + interval '10 minutes', null
  )
  on conflict (session_id) do update
  set user_id = excluded.user_id,
      challenge_hash = excluded.challenge_hash,
      code_hash = excluded.code_hash,
      attempts = 0,
      created_at = now(),
      last_sent_at = now(),
      expires_at = now() + interval '10 minutes',
      consumed_at = null
  where public.email_mfa_challenges.last_sent_at <= now() - interval '60 seconds'
  returning true into issued;

  return coalesce(issued, false);
end;
$$;

create or replace function public.consume_email_mfa_challenge(
  p_session_id uuid,
  p_user_id uuid,
  p_challenge_hash text,
  p_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  challenge public.email_mfa_challenges%rowtype;
begin
  select * into challenge
  from public.email_mfa_challenges
  where session_id = p_session_id
  for update;

  if not found
    or challenge.user_id <> p_user_id
    or challenge.challenge_hash <> p_challenge_hash
    or challenge.consumed_at is not null
    or challenge.expires_at <= now()
    or challenge.attempts >= 5 then
    return false;
  end if;

  if challenge.code_hash <> p_code_hash then
    update public.email_mfa_challenges
    set attempts = attempts + 1
    where session_id = p_session_id;
    return false;
  end if;

  update public.email_mfa_challenges
  set consumed_at = now()
  where session_id = p_session_id;

  insert into public.email_mfa_verified_sessions (session_id, user_id, expires_at)
  values (p_session_id, p_user_id, now() + interval '8 hours')
  on conflict (session_id) do update
  set user_id = excluded.user_id, verified_at = now(), expires_at = excluded.expires_at;

  delete from public.email_mfa_challenges
  where expires_at < now() - interval '1 day';

  delete from public.email_mfa_verified_sessions
  where expires_at < now() - interval '1 day';

  return true;
end;
$$;

revoke all on function public.issue_email_mfa_challenge(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.issue_email_mfa_challenge(uuid, uuid, text, text) to service_role;
revoke all on function public.consume_email_mfa_challenge(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.consume_email_mfa_challenge(uuid, uuid, text, text) to service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.email_mfa_verified_sessions s on s.user_id = p.id
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and s.session_id::text = (auth.jwt() ->> 'session_id')
      and s.expires_at > now()
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

create policy "Admins and regular users can view appropriate profiles"
  on public.profiles for select to authenticated
  using (
    (select public.is_admin())
    or (
      (select auth.uid()) = id
      and role = 'user'
    )
  );

drop policy if exists "Profiles are visible to the user and admins" on public.profiles;
