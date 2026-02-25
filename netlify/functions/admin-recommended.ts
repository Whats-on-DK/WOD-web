import { supabaseFetch } from './supabase';

type HandlerEvent = {
  httpMethod?: string;
  body?: string;
};
type HandlerContext = { clientContext?: { user?: { email?: string; app_metadata?: { roles?: string[] } } } };

type SlotRow = {
  id: string;
  event_id: string;
  event_external_id: string;
  slot_position: number;
  duration_code: string;
  starts_at: string;
  chosen_until_at: string;
  effective_until_at: string;
};

const getRoles = (context: HandlerContext) => {
  const roles = context.clientContext?.user?.app_metadata?.roles;
  return Array.isArray(roles) ? roles : [];
};

const hasAdminRole = (roles: string[]) => roles.includes('admin') || roles.includes('super_admin');

const getActorRole = (roles: string[]) => (roles.includes('super_admin') ? 'super_admin' : 'admin');

const isMigrationMissingError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('PGRST202') || message.includes('recommended_manage');
};

const syncRecommended = async () => {
  await supabaseFetch('rpc/recommended_manage', {
    method: 'POST',
    body: {
      p_action: 'sync',
      p_actor: 'system',
      p_actor_role: 'system'
    }
  });
};

const mapState = async () => {
  const now = new Date().toISOString();
  const slots = (await supabaseFetch('recommended_slots', {
    query: {
      disabled_at: 'is.null',
      effective_until_at: `gt.${now}`,
      order: 'slot_position.asc,created_at.asc',
      limit: '6',
      select:
        'id,event_id,event_external_id,slot_position,duration_code,starts_at,chosen_until_at,effective_until_at'
    }
  })) as SlotRow[];

  const eventIds = (slots || []).map((slot) => slot.event_id).filter(Boolean);
  const events =
    eventIds.length > 0
      ? ((await supabaseFetch('events', {
          query: {
            id: `in.(${eventIds.join(',')})`,
            select:
              'id,external_id,title,start_at,end_at,city,status,format,address,venue,registration_url,price_type'
          }
        })) as any[])
      : [];

  const eventsById = new Map((events || []).map((item) => [item.id, item]));

  return (slots || [])
    .map((slot) => {
      const event = eventsById.get(slot.event_id);
      if (!event) return null;
      return {
        slotPosition: Number(slot.slot_position || 0),
        durationCode: slot.duration_code,
        startsAt: slot.starts_at,
        chosenUntilAt: slot.chosen_until_at,
        effectiveUntilAt: slot.effective_until_at,
        event: {
          id: event.external_id || event.id,
          dbId: event.id,
          title: event.title || 'Untitled event',
          start: event.start_at || '',
          end: event.end_at || null,
          city: event.city || '',
          status: event.status || 'published',
          format: event.format || '',
          address: event.address || '',
          venue: event.venue || '',
          registrationUrl: event.registration_url || '',
          priceType: event.price_type || 'paid'
        }
      };
    })
    .filter(Boolean);
};

export const handler = async (event: HandlerEvent, context: HandlerContext) => {
  try {
    const roles = getRoles(context);
    if (!hasAdminRole(roles)) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'forbidden' })
      };
    }

    const actor = context.clientContext?.user?.email || 'admin';
    const actorRole = getActorRole(roles);
    const method = String(event.httpMethod || 'GET').toUpperCase();

    if (method === 'GET') {
      await syncRecommended();
      const slots = await mapState();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, slots })
      };
    }

    const payload = event.body ? JSON.parse(event.body) : {};
    const action = String(payload.action || '').trim();

    if (!action) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'missing_action' })
      };
    }

    if (action === 'reorder') {
      const order = Array.isArray(payload.order) ? payload.order.map((value) => String(value || '')) : [];
      const result = (await supabaseFetch('rpc/recommended_manage', {
        method: 'POST',
        body: {
          p_action: 'reorder',
          p_order_refs: order,
          p_actor: actor,
          p_actor_role: actorRole
        }
      })) as any;
      if (!result?.ok) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: false, error: result?.error || 'reorder_failed' })
        };
      }
      const slots = await mapState();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, slots })
      };
    }

    if (action === 'remove') {
      const eventId = String(payload.eventId || '').trim();
      const result = (await supabaseFetch('rpc/recommended_manage', {
        method: 'POST',
        body: {
          p_action: 'remove',
          p_event_ref: eventId,
          p_actor: actor,
          p_actor_role: actorRole
        }
      })) as any;
      if (!result?.ok) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: false, error: result?.error || 'remove_failed' })
        };
      }
      const slots = await mapState();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, slots })
      };
    }

    if (action === 'place') {
      const eventId = String(payload.eventId || '').trim();
      const durationCode = String(payload.durationCode || '').trim();
      const slotPosition = Number(payload.slotPosition || 1);
      const result = (await supabaseFetch('rpc/recommended_manage', {
        method: 'POST',
        body: {
          p_action: 'place',
          p_event_ref: eventId,
          p_duration_code: durationCode,
          p_slot_position: Number.isFinite(slotPosition) ? slotPosition : 1,
          p_actor: actor,
          p_actor_role: actorRole
        }
      })) as any;

      if (!result?.ok) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: false, error: result?.error || 'place_failed' })
        };
      }

      const slots = await mapState();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, slots })
      };
    }

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'invalid_action' })
    };
  } catch (error) {
    console.log('admin-recommended error', error);
    if (isMigrationMissingError(error)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: 'migration_required',
          message: 'Run Supabase migration `supabase.recommended.sql` to enable Recommended.'
        })
      };
    }
    const message = error instanceof Error ? error.message : 'unknown_error';
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: message })
    };
  }
};
