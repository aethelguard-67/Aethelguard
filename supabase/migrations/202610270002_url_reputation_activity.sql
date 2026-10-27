create table public.url_reputation_activity (
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

alter table public.url_reputation_activity enable row level security;
revoke all on public.url_reputation_activity from anon, authenticated;

create function public.get_url_reputation_daily_users()
returns table (activity_date date, user_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  return query
  select days.day::date, count(activity.user_id)::bigint
  from generate_series(
    ((now() at time zone 'utc')::date - 29)::timestamp,
    (now() at time zone 'utc')::date::timestamp,
    interval '1 day'
  ) as days(day)
  left join public.url_reputation_activity activity
    on activity.activity_date = days.day::date
  group by days.day
  order by days.day;
end;
$$;

revoke all on function public.get_url_reputation_daily_users() from public;
grant execute on function public.get_url_reputation_daily_users() to authenticated;

notify pgrst, 'reload schema';
