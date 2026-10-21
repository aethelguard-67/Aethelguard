create or replace function public.is_admin_account()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin_account() from public, anon;
grant execute on function public.is_admin_account() to authenticated;
