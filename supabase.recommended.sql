create table if not exists recommended_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  event_external_id text,
  slot_position integer not null,
  duration_code text not null check (duration_code in ('3d', '7d', '14d', 'until_event_end')),
  starts_at timestamptz not null default now(),
  chosen_until_at timestamptz not null,
  effective_until_at timestamptz not null,
  disabled_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Allow temporary high positions during transactional reordering.
  -- Final active positions are always normalized back to 1..6 by recommended_manage().
  constraint recommended_slots_position_chk check (
    -- Active persisted positions are 1..6.
    -- Temporary values can be used inside transactional reorder/shift steps.
    (slot_position between 1 and 6)
    or (slot_position between -999 and -1)
    or slot_position >= 100
  ),
  constraint recommended_slots_event_unique unique (event_id),
  constraint recommended_slots_position_unique unique (slot_position)
);

-- Backward-compatible fix for environments where the old check (1..6 only) already exists.
alter table recommended_slots
  drop constraint if exists recommended_slots_position_chk;
alter table recommended_slots
  add constraint recommended_slots_position_chk
  check (
    (slot_position between 1 and 6)
    or (slot_position between -999 and -1)
    or slot_position >= 100
  );

create table if not exists recommended_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  event_external_id text,
  action text not null,
  status text not null,
  slot_position integer,
  from_position integer,
  to_position integer,
  duration_code text,
  starts_at timestamptz,
  chosen_until_at timestamptz,
  effective_until_at timestamptz,
  actor text,
  actor_role text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists recommended_slots_effective_until_idx
  on recommended_slots (effective_until_at);
create index if not exists recommended_slots_event_external_idx
  on recommended_slots (event_external_id);
create index if not exists recommended_history_created_idx
  on recommended_history (created_at desc);
create index if not exists recommended_history_event_external_idx
  on recommended_history (event_external_id);

alter table recommended_slots enable row level security;
alter table recommended_history enable row level security;

drop policy if exists "public_read_recommended_slots" on recommended_slots;
create policy "public_read_recommended_slots"
on recommended_slots
for select
to public
using (disabled_at is null and effective_until_at > now());

create or replace function recommended_manage(
  p_action text,
  p_event_ref text default null,
  p_duration_code text default null,
  p_slot_position integer default null,
  p_order_refs text[] default null,
  p_actor text default null,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_now timestamptz := now();
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'system');
  v_actor_role text := coalesce(nullif(trim(p_actor_role), ''), 'system');
  v_event events%rowtype;
  v_existing recommended_slots%rowtype;
  v_active_count integer := 0;
  v_target_pos integer := 1;
  v_chosen_until timestamptz;
  v_effective_end timestamptz;
  v_effective_until timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('recommended_slots_lock'));

  with expired as (
    delete from recommended_slots rs
    where rs.disabled_at is null
      and rs.effective_until_at <= v_now
    returning rs.*
  )
  insert into recommended_history (
    event_id,
    event_external_id,
    action,
    status,
    slot_position,
    from_position,
    to_position,
    duration_code,
    starts_at,
    chosen_until_at,
    effective_until_at,
    actor,
    actor_role,
    details,
    created_at
  )
  select
    event_id,
    event_external_id,
    'expired',
    'expired',
    slot_position,
    slot_position,
    null,
    duration_code,
    starts_at,
    chosen_until_at,
    effective_until_at,
    'system',
    'system',
    '{}'::jsonb,
    v_now
  from expired;

  with ranked as (
    select id, row_number() over (order by slot_position asc, created_at asc, id asc) as next_pos
    from recommended_slots
    where disabled_at is null
  ), shifted as (
    update recommended_slots rs
    set slot_position = ranked.next_pos + 100,
        updated_at = v_now
    from ranked
    where rs.id = ranked.id
    returning rs.id
  )
  update recommended_slots
  set slot_position = slot_position - 100,
      updated_at = v_now
  where id in (select id from shifted);

  if p_action = 'sync' or p_action = 'list' then
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'place' then
    if p_event_ref is null or length(trim(p_event_ref)) = 0 then
      return jsonb_build_object('ok', false, 'error', 'missing_event');
    end if;
    if p_duration_code not in ('3d', '7d', '14d', 'until_event_end') then
      return jsonb_build_object('ok', false, 'error', 'invalid_duration');
    end if;

    select *
    into v_event
    from events e
    where e.external_id = p_event_ref
       or e.id::text = p_event_ref
    limit 1;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'event_not_found');
    end if;

    if coalesce(v_event.status, 'published') <> 'published' then
      return jsonb_build_object('ok', false, 'error', 'event_not_published');
    end if;

    v_effective_end := coalesce(v_event.end_at, v_event.start_at + interval '1 hour');
    if v_event.start_at is null or v_effective_end is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_event_dates');
    end if;

    if p_duration_code = 'until_event_end' then
      v_chosen_until := v_effective_end;
    elsif p_duration_code = '3d' then
      v_chosen_until := v_now + interval '3 day';
    elsif p_duration_code = '7d' then
      v_chosen_until := v_now + interval '7 day';
    else
      v_chosen_until := v_now + interval '14 day';
    end if;

    v_effective_until := least(v_chosen_until, v_effective_end);
    if v_effective_until <= v_now then
      return jsonb_build_object('ok', false, 'error', 'event_already_ended');
    end if;

    select *
    into v_existing
    from recommended_slots rs
    where rs.event_id = v_event.id
    limit 1;

    if found then
      delete from recommended_slots where id = v_existing.id;
      insert into recommended_history (
        event_id, event_external_id, action, status, slot_position, from_position, to_position,
        duration_code, starts_at, chosen_until_at, effective_until_at,
        actor, actor_role, details, created_at
      ) values (
        v_existing.event_id,
        coalesce(v_existing.event_external_id, v_event.external_id, v_event.id::text),
        'disabled',
        'disabled',
        v_existing.slot_position,
        v_existing.slot_position,
        null,
        v_existing.duration_code,
        v_existing.starts_at,
        v_existing.chosen_until_at,
        v_existing.effective_until_at,
        v_actor,
        v_actor_role,
        jsonb_build_object('reason', 'replaced'),
        v_now
      );

      with ranked as (
        select id, row_number() over (order by slot_position asc, created_at asc, id asc) as next_pos
        from recommended_slots
        where disabled_at is null
      ), shifted as (
        update recommended_slots rs
        set slot_position = ranked.next_pos + 100,
            updated_at = v_now
        from ranked
        where rs.id = ranked.id
        returning rs.id
      )
      update recommended_slots
      set slot_position = slot_position - 100,
          updated_at = v_now
      where id in (select id from shifted);
    end if;

    select count(*)
    into v_active_count
    from recommended_slots rs
    where rs.disabled_at is null;

    if v_active_count >= 6 then
      return jsonb_build_object('ok', false, 'error', 'max_slots_reached');
    end if;

    v_target_pos := greatest(1, least(coalesce(p_slot_position, 1), v_active_count + 1));

    update recommended_slots
    set slot_position = slot_position + 100,
        updated_at = v_now
    where disabled_at is null
      and slot_position >= v_target_pos;

    update recommended_slots
    set slot_position = slot_position - 99,
        updated_at = v_now
    where disabled_at is null
      and slot_position >= (v_target_pos + 100);

    insert into recommended_slots (
      event_id,
      event_external_id,
      slot_position,
      duration_code,
      starts_at,
      chosen_until_at,
      effective_until_at,
      created_by,
      created_at,
      updated_at
    ) values (
      v_event.id,
      coalesce(v_event.external_id, v_event.id::text),
      v_target_pos,
      p_duration_code,
      v_now,
      v_chosen_until,
      v_effective_until,
      v_actor,
      v_now,
      v_now
    );

    insert into recommended_history (
      event_id,
      event_external_id,
      action,
      status,
      slot_position,
      from_position,
      to_position,
      duration_code,
      starts_at,
      chosen_until_at,
      effective_until_at,
      actor,
      actor_role,
      details,
      created_at
    ) values (
      v_event.id,
      coalesce(v_event.external_id, v_event.id::text),
      'placed',
      'active',
      v_target_pos,
      null,
      v_target_pos,
      p_duration_code,
      v_now,
      v_chosen_until,
      v_effective_until,
      v_actor,
      v_actor_role,
      '{}'::jsonb,
      v_now
    );

    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'remove' then
    if p_event_ref is null or length(trim(p_event_ref)) = 0 then
      return jsonb_build_object('ok', false, 'error', 'missing_event');
    end if;

    select rs.*
    into v_existing
    from recommended_slots rs
    where rs.event_external_id = p_event_ref
       or rs.event_id::text = p_event_ref
    limit 1;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    delete from recommended_slots where id = v_existing.id;

    insert into recommended_history (
      event_id,
      event_external_id,
      action,
      status,
      slot_position,
      from_position,
      to_position,
      duration_code,
      starts_at,
      chosen_until_at,
      effective_until_at,
      actor,
      actor_role,
      details,
      created_at
    ) values (
      v_existing.event_id,
      coalesce(v_existing.event_external_id, v_existing.event_id::text),
      'disabled',
      'disabled',
      v_existing.slot_position,
      v_existing.slot_position,
      null,
      v_existing.duration_code,
      v_existing.starts_at,
      v_existing.chosen_until_at,
      v_existing.effective_until_at,
      v_actor,
      v_actor_role,
      '{}'::jsonb,
      v_now
    );

    with ranked as (
      select id, row_number() over (order by slot_position asc, created_at asc, id asc) as next_pos
      from recommended_slots
      where disabled_at is null
    ), shifted as (
      update recommended_slots rs
      set slot_position = ranked.next_pos + 100,
          updated_at = v_now
      from ranked
      where rs.id = ranked.id
      returning rs.id
    )
    update recommended_slots
    set slot_position = slot_position - 100,
        updated_at = v_now
    where id in (select id from shifted);

    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'reorder' then
    if p_order_refs is null or cardinality(p_order_refs) = 0 then
      return jsonb_build_object('ok', false, 'error', 'missing_order');
    end if;

    with current_items as (
      select rs.id, rs.slot_position
      from recommended_slots rs
      where rs.disabled_at is null
    ), mapped as (
      select
        ci.id,
        ci.slot_position as old_pos,
        row_number() over (order by x.ord) as new_pos
      from unnest(p_order_refs) with ordinality as x(ref, ord)
      join recommended_slots rs
        on (rs.event_external_id = x.ref or rs.event_id::text = x.ref)
      join current_items ci on ci.id = rs.id
      where rs.disabled_at is null
    ), remaining as (
      select
        ci.id,
        ci.slot_position as old_pos,
        row_number() over (order by ci.slot_position) + (select count(*) from mapped) as new_pos
      from current_items ci
      where ci.id not in (select id from mapped)
    ), combined as (
      select * from mapped
      union all
      select * from remaining
    ), shifted as (
      update recommended_slots rs
      set slot_position = combined.new_pos + 100,
          updated_at = v_now
      from combined
      where rs.id = combined.id
      returning rs.id
    )
    update recommended_slots
    set slot_position = slot_position - 100,
        updated_at = v_now
    where id in (select id from shifted);

    insert into recommended_history (
      event_id,
      event_external_id,
      action,
      status,
      slot_position,
      from_position,
      to_position,
      duration_code,
      starts_at,
      chosen_until_at,
      effective_until_at,
      actor,
      actor_role,
      details,
      created_at
    )
    select
      rs.event_id,
      coalesce(rs.event_external_id, rs.event_id::text),
      'reordered',
      'active',
      rs.slot_position,
      null,
      rs.slot_position,
      rs.duration_code,
      rs.starts_at,
      rs.chosen_until_at,
      rs.effective_until_at,
      v_actor,
      v_actor_role,
      '{}'::jsonb,
      v_now
    from recommended_slots rs
    where rs.disabled_at is null;

    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'invalid_action');
end;
$$;
