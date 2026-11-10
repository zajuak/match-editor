begin;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  lineups boolean not null default true,
  position integer not null default 0,
  constraint tournaments_name_trimmed check (name = btrim(name)),
  constraint tournaments_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint tournaments_position_nonnegative check (position >= 0)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  constraint teams_tournament_name_unique unique (tournament_id, name),
  constraint teams_name_trimmed check (name = btrim(name)),
  constraint teams_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint teams_position_nonnegative check (position >= 0)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  legacy_key text unique,
  constraint players_team_name_unique unique (team_id, name),
  constraint players_name_trimmed check (name = btrim(name)),
  constraint players_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint players_position_nonnegative check (position >= 0)
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null,
  constraint admin_users_role_admin check (role = 'admin')
);

create index tournaments_position_idx on public.tournaments(position);
create index teams_tournament_position_idx on public.teams(tournament_id, position);
create index players_team_position_idx on public.players(team_id, position);

-- No default table or function EXECUTE privileges are left to PUBLIC/API roles.
revoke all on table public.tournaments, public.teams, public.players, public.admin_users
  from public, anon, authenticated, service_role;

grant select on table public.tournaments, public.teams, public.players to anon, authenticated;
grant insert, update, delete on table public.tournaments, public.teams, public.players to authenticated;
grant select, insert, update, delete on table public.tournaments, public.teams, public.players to service_role;
grant select, insert, update, delete on table public.admin_users to service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

alter table public.tournaments enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.admin_users enable row level security;

create policy tournaments_public_select on public.tournaments
  for select to anon, authenticated using (true);
create policy teams_public_select on public.teams
  for select to anon, authenticated using (true);
create policy players_public_select on public.players
  for select to anon, authenticated using (true);

create policy tournaments_admin_insert on public.tournaments
  for insert to authenticated with check (public.is_admin());
create policy tournaments_admin_update on public.tournaments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tournaments_admin_delete on public.tournaments
  for delete to authenticated using (public.is_admin());

create policy teams_admin_insert on public.teams
  for insert to authenticated with check (public.is_admin());
create policy teams_admin_update on public.teams
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy teams_admin_delete on public.teams
  for delete to authenticated using (public.is_admin());

create policy players_admin_insert on public.players
  for insert to authenticated with check (public.is_admin());
create policy players_admin_update on public.players
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy players_admin_delete on public.players
  for delete to authenticated using (public.is_admin());

-- One PostgREST call is one transaction. The lock closes the empty-check race;
-- plain INSERTs (never upserts) preserve all existing/back-office changes.
create or replace function public.seed_rosters(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_count integer;
  team_count integer;
  player_count integer;
begin
  if jsonb_typeof(payload -> 'tournaments') is distinct from 'array'
    or jsonb_typeof(payload -> 'teams') is distinct from 'array'
    or jsonb_typeof(payload -> 'players') is distinct from 'array' then
    raise exception '种子数据必须包含 tournaments、teams、players 三个数组。';
  end if;

  lock table public.tournaments, public.teams, public.players in share row exclusive mode;

  if exists (select 1 from public.tournaments)
    or exists (select 1 from public.teams)
    or exists (select 1 from public.players) then
    raise exception '目标名单表必须全部为空；检测到已有数据，未执行导入。';
  end if;

  insert into public.tournaments (name, lineups, position)
  select source.name, source.lineups, source.position
  from jsonb_to_recordset(payload -> 'tournaments')
    as source(name text, lineups boolean, position integer)
  order by source.position;
  get diagnostics tournament_count = row_count;
  if tournament_count <> jsonb_array_length(payload -> 'tournaments') then
    raise exception '种子赛事插入数量不符，事务已回滚。';
  end if;

  insert into public.teams (tournament_id, name, position)
  select tournament.id, source.name, source.position
  from jsonb_to_recordset(payload -> 'teams')
    as source(tournament_name text, name text, position integer)
  join public.tournaments tournament on tournament.name = source.tournament_name
  order by source.tournament_name, source.position;
  get diagnostics team_count = row_count;
  if team_count <> jsonb_array_length(payload -> 'teams') then
    raise exception '种子球队与赛事关联不完整，事务已回滚。';
  end if;

  insert into public.players (team_id, name, position, legacy_key)
  select team.id, source.name, source.position, source.legacy_key
  from jsonb_to_recordset(payload -> 'players')
    as source(tournament_name text, team_name text, name text, position integer, legacy_key text)
  join public.tournaments tournament on tournament.name = source.tournament_name
  join public.teams team
    on team.tournament_id = tournament.id
    and team.name = source.team_name
  order by source.tournament_name, source.team_name, source.position;
  get diagnostics player_count = row_count;
  if player_count <> jsonb_array_length(payload -> 'players') then
    raise exception '种子球员与球队关联不完整，事务已回滚。';
  end if;

  return jsonb_build_object(
    'tournaments', tournament_count,
    'teams', team_count,
    'players', player_count
  );
end;
$$;

revoke all on function public.seed_rosters(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.seed_rosters(jsonb) to service_role;

commit;
