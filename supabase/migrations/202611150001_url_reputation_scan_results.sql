create table public.url_reputation_scan_results (
  user_id uuid not null references public.profiles(id) on delete cascade,
  url_hash text not null check (url_hash ~ '^[0-9a-f]{64}$'),
  analysis_id text,
  reputation text not null check (reputation in ('pending', 'clean', 'suspicious', 'malicious')),
  checked_at timestamptz not null default now(),
  primary key (user_id, url_hash)
);

create unique index url_reputation_scan_results_analysis_id_idx
  on public.url_reputation_scan_results (user_id, analysis_id)
  where analysis_id is not null;

alter table public.url_reputation_scan_results enable row level security;
revoke all on public.url_reputation_scan_results from anon, authenticated;
grant select on public.url_reputation_scan_results to authenticated;

create policy "Users can read their own URL reputation scan results"
  on public.url_reputation_scan_results
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create function public.record_url_reputation_scan(
  p_url_hash text,
  p_reputation text,
  p_analysis_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_url_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid URL hash';
  end if;
  if p_reputation not in ('pending', 'clean', 'suspicious', 'malicious') then
    raise exception 'Invalid URL reputation';
  end if;

  insert into public.url_reputation_scan_results (user_id, url_hash, analysis_id, reputation, checked_at)
  values (v_user_id, p_url_hash, p_analysis_id, p_reputation, now())
  on conflict (user_id, url_hash) do update
  set analysis_id = coalesce(excluded.analysis_id, public.url_reputation_scan_results.analysis_id),
      reputation = case
        when excluded.reputation = 'pending'
          and public.url_reputation_scan_results.reputation <> 'pending'
          then public.url_reputation_scan_results.reputation
        else excluded.reputation
      end,
      checked_at = now();
end;
$$;

revoke all on function public.record_url_reputation_scan(text, text, text) from public, anon;
grant execute on function public.record_url_reputation_scan(text, text, text) to authenticated;

create function public.get_my_url_reputation_scan_counts()
returns table (safe_count bigint, suspicious_count bigint, malicious_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    count(*) filter (where reputation = 'clean'),
    count(*) filter (where reputation = 'suspicious'),
    count(*) filter (where reputation = 'malicious')
  from public.url_reputation_scan_results
  where user_id = auth.uid();
end;
$$;

revoke all on function public.get_my_url_reputation_scan_counts() from public, anon;
grant execute on function public.get_my_url_reputation_scan_counts() to authenticated;

notify pgrst, 'reload schema';
