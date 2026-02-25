import { supabaseFetch } from './supabase';

type RecommendedSlot = {
  id: string;
  event_id: string;
  event_external_id: string;
  slot_position: number;
  duration_code: string;
  starts_at: string;
  chosen_until_at: string;
  effective_until_at: string;
};

const mapRecommendedEvent = (slot: RecommendedSlot, event: any) => ({
  id: event?.external_id || event?.id || slot.event_external_id || slot.event_id,
  title: event?.title || 'Untitled event',
  start: event?.start_at || '',
  end: event?.end_at || null,
  imageUrl: event?.image_url || '',
  city: event?.city || '',
  format: event?.format || '',
  address: event?.address || '',
  venue: event?.venue || '',
  registrationUrl: event?.registration_url || '',
  priceType: event?.price_type || 'paid',
  position: Number(slot.slot_position || 0),
  chosenUntilAt: slot.chosen_until_at,
  effectiveUntilAt: slot.effective_until_at
});

const syncRecommended = async () => {
  await supabaseFetch('rpc/recommended_manage', {
    method: 'POST',
    body: {
      p_action: 'sync',
      p_event_ref: null,
      p_duration_code: null,
      p_slot_position: null,
      p_order_refs: null,
      p_actor: 'system',
      p_actor_role: 'system'
    }
  });
};

export const handler = async () => {
  try {
    await syncRecommended();
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
    })) as RecommendedSlot[];

    const eventIds = (slots || []).map((slot) => slot.event_id).filter(Boolean);
    const events =
      eventIds.length > 0
        ? ((await supabaseFetch('events', {
            query: {
              id: `in.(${eventIds.join(',')})`,
              status: 'eq.published',
              select:
                'id,external_id,title,start_at,end_at,image_url,city,format,address,venue,registration_url,price_type'
            }
          })) as any[])
        : [];

    const byId = new Map((events || []).map((item) => [item.id, item]));
    const payload = (slots || [])
      .map((slot) => {
        const event = byId.get(slot.event_id);
        if (!event) return null;
        return mapRecommendedEvent(slot, event);
      })
      .filter(Boolean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, recommended: payload })
    };
  } catch (error) {
    console.log('public-recommended error', error);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, recommended: [] })
    };
  }
};
