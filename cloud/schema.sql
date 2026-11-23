-- Run in the Supabase SQL Editor for your own project.
create table if not exists public.admin_workbench_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_workbench_state enable row level security;
revoke all on public.admin_workbench_state from anon, authenticated;
grant select on public.admin_workbench_state to authenticated;

drop policy if exists admin_workbench_owner_read on public.admin_workbench_state;
create policy admin_workbench_owner_read on public.admin_workbench_state
  for select to authenticated using ((select auth.uid()) = user_id);

-- A version check prevents one device from silently overwriting another.
create or replace function public.save_admin_workbench(p_expected bigint, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_revision bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_expected is null or p_expected < 0 or p_data is null
    or jsonb_typeof(p_data) <> 'object'
    or octet_length(p_data::text) > 2000000
    or coalesce(jsonb_typeof(p_data->'tasks'), '') <> 'array'
    or coalesce(jsonb_typeof(p_data->'contracts'), '') <> 'array'
    or coalesce(jsonb_typeof(p_data->'stock'), '') <> 'array'
    or coalesce(jsonb_typeof(p_data->'guides'), '') <> 'array'
    or coalesce(jsonb_typeof(p_data->'writingSamples'), '') <> 'array' then
    raise exception 'invalid_workbench_data';
  end if;

  if p_expected = 0 then
    insert into public.admin_workbench_state(user_id, revision, data)
    values (v_uid, 1, p_data)
    on conflict (user_id) do nothing
    returning revision into v_revision;
  else
    update public.admin_workbench_state
       set data = p_data, revision = revision + 1, updated_at = now()
     where user_id = v_uid and revision = p_expected
    returning revision into v_revision;
  end if;
  if v_revision is null then
    raise exception 'revision_conflict';
  end if;
  return v_revision;
end;
$$;
revoke all on function public.save_admin_workbench(bigint,jsonb) from public, anon;
grant execute on function public.save_admin_workbench(bigint,jsonb) to authenticated;

-- Add the table to Realtime only once.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'admin_workbench_state'
  ) then
    alter publication supabase_realtime add table public.admin_workbench_state;
  end if;
end;
$$;
