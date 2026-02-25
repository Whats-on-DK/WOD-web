import { supabaseFetch } from './supabase';

type HandlerContext = { clientContext?: { user?: { app_metadata?: { roles?: string[] } } } };

const getRoles = (context: HandlerContext) => {
  const roles = context.clientContext?.user?.app_metadata?.roles;
  return Array.isArray(roles) ? roles : [];
};

const hasAdminRole = (roles: string[]) => roles.includes('admin') || roles.includes('super_admin');

export const handler = async (_event: unknown, context: HandlerContext) => {
  try {
    const roles = getRoles(context);
    if (!hasAdminRole(roles)) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'forbidden' })
      };
    }

    const rows = (await supabaseFetch('recommended_history', {
      query: {
        order: 'created_at.desc',
        limit: '500',
        select:
          'id,event_id,event_external_id,action,status,slot_position,from_position,to_position,duration_code,starts_at,chosen_until_at,effective_until_at,actor,actor_role,details,created_at'
      }
    })) as any[];

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, history: rows || [] })
    };
  } catch (error) {
    console.log('admin-recommended-history error', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, history: [] })
    };
  }
};
