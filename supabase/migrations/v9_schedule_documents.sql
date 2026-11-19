-- V9 · Permanent electives and annual schedule documents.
-- V8 tables remain untouched. No student names are involved.

create table if not exists public.v9_electives (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  created_at timestamptz not null default now(),
  unique (id, branch_id)
);
create unique index if not exists v9_electives_branch_name_unique
  on public.v9_electives (branch_id, lower(btrim(name)));

create table if not exists public.v9_schedule_documents (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  year_start smallint not null check (year_start between 2025 and 2100),
  selection_deadline date not null,
  status text not null default 'draft' check (status in ('draft','active','finished')),
  created_at timestamptz not null default now(),
  unique (branch_id, year_start),
  unique (id, branch_id),
  constraint v9_schedule_deadline_year_check check (
    selection_deadline between make_date(year_start, 1, 1)
                           and make_date(year_start + 1, 12, 31)
  )
);

create table if not exists public.v9_schedule_groups (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  branch_id uuid not null,
  elective_id uuid not null,
  group_name text not null check (char_length(btrim(group_name)) between 1 and 60),
  kind text not null check (kind in ('regular','olympiad')),
  -- Empty array means all grades (1-4); otherwise restrict to indicated grades.
  grade_targets smallint[] not null default '{}'::smallint[]
    check (grade_targets <@ array[1,2,3,4]::smallint[] and array_position(grade_targets, null) is null),
  created_at timestamptz not null default now(),
  foreign key (document_id, branch_id)
    references public.v9_schedule_documents(id, branch_id) on delete restrict,
  foreign key (elective_id, branch_id)
    references public.v9_electives(id, branch_id) on delete restrict
);
create index if not exists v9_schedule_groups_document_idx on public.v9_schedule_groups(document_id);
create index if not exists v9_schedule_groups_elective_idx on public.v9_schedule_groups(elective_id);
create unique index if not exists v9_schedule_groups_name_unique
  on public.v9_schedule_groups(document_id, elective_id, kind, lower(btrim(group_name)));

create table if not exists public.v9_schedule_sessions (
  group_id uuid not null references public.v9_schedule_groups(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 5),
  slot_id smallint not null references public.time_slots(id) on delete restrict,
  -- Historical snapshot of the times: changes to the slot template do not rewrite past years.
  time_from time not null,
  time_to time not null,
  primary key (group_id, weekday, slot_id),
  check (time_from < time_to)
);

-- Database-side lifecycle guards also apply to direct REST mutations.
create or replace function private.v9_guard_elective_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.branch_id is distinct from old.branch_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Можно изменять только название допа';
  end if;
  return new;
end;
$$;
drop trigger if exists v9_guard_elective_identity on public.v9_electives;
create trigger v9_guard_elective_identity before update on public.v9_electives
for each row execute function private.v9_guard_elective_identity();

create or replace function private.v9_guard_schedule_document()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'finished' then
    raise exception 'Завершённый документ расписания неизменяем';
  end if;
  if new.id is distinct from old.id or new.branch_id is distinct from old.branch_id
     or new.year_start is distinct from old.year_start
     or new.created_at is distinct from old.created_at then
    raise exception 'Нельзя менять идентификатор, филиал или учебный год документа';
  end if;
  if (old.status = 'draft' and new.status not in ('draft','active'))
     or (old.status = 'active' and new.status not in ('active','finished')) then
    raise exception 'Недопустимый переход статуса документа расписания';
  end if;
  if (now() at time zone 'Europe/Moscow')::date > old.selection_deadline
     and new.selection_deadline is distinct from old.selection_deadline then
    raise exception 'Срок выбора уже истёк, его нельзя изменять';
  end if;
  if old.status = 'draft' and new.status = 'active' then
    if not exists (select 1 from public.v9_schedule_groups g where g.document_id = old.id) then
      raise exception 'Сначала добавьте хотя бы одну группу в расписание';
    end if;
    if exists (
      select 1 from public.v9_schedule_groups g
      where g.document_id = old.id
        and not exists(select 1 from public.v9_schedule_sessions s where s.group_id = g.id)
    ) then
      raise exception 'У каждой группы должны быть занятия';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists v9_guard_schedule_document on public.v9_schedule_documents;
create trigger v9_guard_schedule_document before update on public.v9_schedule_documents
for each row execute function private.v9_guard_schedule_document();

create or replace function private.v9_guard_schedule_group()
returns trigger language plpgsql set search_path = '' as $$
declare d record; v_document_id uuid;
begin
  v_document_id := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  select status, selection_deadline into d
    from public.v9_schedule_documents where id = v_document_id for share;
  if not found or d.status = 'finished' then
    raise exception 'Завершённый документ нельзя редактировать';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.document_id is distinct from old.document_id
       or new.branch_id is distinct from old.branch_id or new.created_at is distinct from old.created_at then
      raise exception 'Нельзя переносить группу в другой документ или филиал';
    end if;
  end if;
  if (now() at time zone 'Europe/Moscow')::date > d.selection_deadline then
    if tg_op <> 'UPDATE' or new.elective_id is distinct from old.elective_id
       or new.kind is distinct from old.kind or new.grade_targets is distinct from old.grade_targets then
      raise exception 'После срока выбора можно менять только название группы';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists v9_guard_schedule_group on public.v9_schedule_groups;
create trigger v9_guard_schedule_group before insert or update or delete on public.v9_schedule_groups
for each row execute function private.v9_guard_schedule_group();

create or replace function private.v9_guard_schedule_session()
returns trigger language plpgsql set search_path = '' as $$
declare v_document record; v_group_id uuid;
begin
  v_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  select doc.status,doc.selection_deadline into v_document
  from public.v9_schedule_groups g
  join public.v9_schedule_documents doc on doc.id = g.document_id
  where g.id = v_group_id for share of doc;
  if not found or v_document.status = 'finished'
     or (now() at time zone 'Europe/Moscow')::date > v_document.selection_deadline then
    raise exception 'Состав занятий этого расписания больше нельзя изменять';
  end if;
  if tg_op = 'UPDATE' and new.group_id is distinct from old.group_id then
    raise exception 'Нельзя переносить занятие в другую группу';
  end if;
  if tg_op <> 'DELETE' and not exists (
    select 1 from public.time_slots t
    where t.id = new.slot_id and t.time_from = new.time_from and t.time_to = new.time_to
  ) then
    raise exception 'Время занятия не соответствует выбранному слоту';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists v9_guard_schedule_session on public.v9_schedule_sessions;
create trigger v9_guard_schedule_session before insert or update or delete on public.v9_schedule_sessions
for each row execute function private.v9_guard_schedule_session();

-- Atomic save: either the group and all its slots are stored, or nothing is.
create or replace function public.v9_save_schedule_group(
  p_document_id uuid, p_elective_id uuid, p_name text,
  p_kind text, p_grade_targets smallint[], p_slots jsonb, p_group_id uuid default null
) returns uuid language plpgsql set search_path = '' as $$
declare d record; v_group_id uuid; v_count integer;
begin
  select id,branch_id,status,selection_deadline into d
  from public.v9_schedule_documents where id = p_document_id for share;
  if not found or (select private.my_role()) is distinct from 'methodologist'
     or (select private.my_branch_id()) is distinct from d.branch_id then
    raise exception 'Документ не найден или нет прав';
  end if;
  if d.status = 'finished' or (now() at time zone 'Europe/Moscow')::date > d.selection_deadline then
    raise exception 'Изменение расписания заблокировано';
  end if;
  if p_kind not in ('regular','olympiad')
     or p_name is null or char_length(btrim(p_name)) not between 1 and 60
     or not exists(select 1 from public.v9_electives e where e.id = p_elective_id and e.branch_id = d.branch_id)
     or p_grade_targets is null or not (p_grade_targets <@ array[1,2,3,4]::smallint[])
     or array_position(p_grade_targets,null) is not null then
    raise exception 'Некорректное направление, тип, название или параллели';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array'
     or jsonb_array_length(p_slots) not between 1 and 10 then
    raise exception 'Укажите от 1 до 10 занятий';
  end if;
  select count(*) into v_count from (
    select distinct x.weekday,x.slot_id
    from jsonb_to_recordset(p_slots) as x(weekday smallint,slot_id smallint)
    join public.time_slots t on t.id=x.slot_id
    where x.weekday between 1 and 5
  ) valid;
  if v_count <> jsonb_array_length(p_slots) then
    raise exception 'Есть повторяющиеся или недопустимые занятия';
  end if;
  if p_group_id is null then
    insert into public.v9_schedule_groups(document_id,branch_id,elective_id,group_name,kind,grade_targets)
    values(d.id,d.branch_id,p_elective_id,btrim(p_name),p_kind,p_grade_targets)
    returning id into v_group_id;
  else
    update public.v9_schedule_groups
    set elective_id=p_elective_id,group_name=btrim(p_name),kind=p_kind,grade_targets=p_grade_targets
    where id=p_group_id and document_id=d.id
    returning id into v_group_id;
    if v_group_id is null then raise exception 'Группа не найдена в документе'; end if;
    delete from public.v9_schedule_sessions where group_id=v_group_id;
  end if;
  insert into public.v9_schedule_sessions(group_id,weekday,slot_id,time_from,time_to)
  select v_group_id,x.weekday,x.slot_id,t.time_from,t.time_to
  from jsonb_to_recordset(p_slots) as x(weekday smallint,slot_id smallint)
  join public.time_slots t on t.id=x.slot_id;
  return v_group_id;
end;
$$;
revoke execute on function public.v9_save_schedule_group(uuid,uuid,text,text,smallint[],jsonb,uuid)
  from public, anon;
grant execute on function public.v9_save_schedule_group(uuid,uuid,text,text,smallint[],jsonb,uuid)
  to authenticated;

-- Delete child sessions first, while the parent group is still visible to guards.
create or replace function public.v9_delete_schedule_group(p_group_id uuid)
returns void language plpgsql set search_path = '' as $$
declare g record;
begin
  select sg.id,sg.branch_id,d.status,d.selection_deadline into g
  from public.v9_schedule_groups sg
  join public.v9_schedule_documents d on d.id=sg.document_id
  where sg.id=p_group_id for share of d;
  if not found or (select private.my_role()) is distinct from 'methodologist'
     or (select private.my_branch_id()) is distinct from g.branch_id then
    raise exception 'Группа не найдена или нет прав';
  end if;
  if g.status='finished' or (now() at time zone 'Europe/Moscow')::date>g.selection_deadline then
    raise exception 'Расписание больше нельзя изменять';
  end if;
  delete from public.v9_schedule_sessions where group_id=p_group_id;
  delete from public.v9_schedule_groups where id=p_group_id;
end;
$$;
revoke execute on function public.v9_delete_schedule_group(uuid) from public, anon;
grant execute on function public.v9_delete_schedule_group(uuid) to authenticated;

alter table public.v9_electives enable row level security;
alter table public.v9_schedule_documents enable row level security;
alter table public.v9_schedule_groups enable row level security;
alter table public.v9_schedule_sessions enable row level security;

create policy v9_electives_read on public.v9_electives for select to authenticated
using (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist');
create policy v9_electives_insert on public.v9_electives for insert to authenticated
with check (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist');
create policy v9_electives_update on public.v9_electives for update to authenticated
using (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist')
with check (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist');

create policy v9_schedule_documents_read on public.v9_schedule_documents for select to authenticated
using (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist');
create policy v9_schedule_documents_insert on public.v9_schedule_documents for insert to authenticated
with check (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist' and status = 'draft');
create policy v9_schedule_documents_update on public.v9_schedule_documents for update to authenticated
using (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist')
with check (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist');

create policy v9_schedule_groups_read on public.v9_schedule_groups for select to authenticated
using (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist');
create policy v9_schedule_groups_insert on public.v9_schedule_groups for insert to authenticated
with check (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist');
create policy v9_schedule_groups_update on public.v9_schedule_groups for update to authenticated
using (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist')
with check (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist');
create policy v9_schedule_groups_delete on public.v9_schedule_groups for delete to authenticated
using (branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist');

create policy v9_schedule_sessions_read on public.v9_schedule_sessions for select to authenticated
using (exists (select 1 from public.v9_schedule_groups g where g.id = group_id
  and g.branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist'));
create policy v9_schedule_sessions_insert on public.v9_schedule_sessions for insert to authenticated
with check (exists (select 1 from public.v9_schedule_groups g where g.id = group_id
  and g.branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist'));
create policy v9_schedule_sessions_delete on public.v9_schedule_sessions for delete to authenticated
using (exists (select 1 from public.v9_schedule_groups g where g.id = group_id
  and g.branch_id = (select private.my_branch_id()) and (select private.my_role()) = 'methodologist'));

grant select,insert,update on public.v9_electives to authenticated;
grant select,insert,update on public.v9_schedule_documents to authenticated;
grant select,insert,update,delete on public.v9_schedule_groups to authenticated;
grant select,insert,delete on public.v9_schedule_sessions to authenticated;
