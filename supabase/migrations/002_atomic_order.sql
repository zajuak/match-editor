begin;

-- Authorize once inside the transaction, lock the selected collection, and
-- normalize duplicate positions before swapping. No half-finished order is visible.
create function public.reorder_roster_records(kind text, first_id uuid, second_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_table text;
  parent_column text;
  first_parent uuid;
  second_parent uuid;
  first_position integer;
  second_position integer;
begin
  if not public.is_admin() then
    raise exception '只有管理员可以调整顺序。' using errcode = '42501';
  end if;
  if first_id is null or second_id is null or first_id = second_id then
    raise exception '请选择两条不同的记录。';
  end if;
  case kind
    when 'tournament' then target_table := 'tournaments'; parent_column := null;
    when 'team' then target_table := 'teams'; parent_column := 'tournament_id';
    when 'player' then target_table := 'players'; parent_column := 'team_id';
    else raise exception '无效的名单类型。';
  end case;
  execute format('lock table public.%I in share row exclusive mode', target_table);
  execute format('select position from public.%I where id = $1', target_table)
    into first_position using first_id;
  execute format('select position from public.%I where id = $1', target_table)
    into second_position using second_id;
  if first_position is null or second_position is null then
    raise exception '记录已删除，请刷新名单。';
  end if;
  if parent_column is not null then
    execute format('select %I from public.%I where id = $1', parent_column, target_table)
      into first_parent using first_id;
    execute format('select %I from public.%I where id = $1', parent_column, target_table)
      into second_parent using second_id;
    if first_parent is distinct from second_parent then
      raise exception '只能调整同一上级下的顺序。';
    end if;
  end if;
  execute format(
    'with ranked as (select id, (row_number() over(order by position, id) - 1)::integer as pos from public.%I %s)
     update public.%I as target set position = ranked.pos from ranked where target.id = ranked.id',
    target_table, case when parent_column is null then '' else format('where %I = $1', parent_column) end,
    target_table) using first_parent;
  execute format('select position from public.%I where id = $1', target_table)
    into first_position using first_id;
  execute format('select position from public.%I where id = $1', target_table)
    into second_position using second_id;
  execute format('update public.%I set position = case id when $1 then $4 else $3 end where id in ($1, $2)', target_table)
    using first_id, second_id, first_position, second_position;
end;
$$;

revoke all on function public.reorder_roster_records(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reorder_roster_records(text, uuid, uuid) to authenticated;
commit;
