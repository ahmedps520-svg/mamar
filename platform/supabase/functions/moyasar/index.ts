// Supabase Edge Function "moyasar" — verifies a Moyasar payment with the business's SECRET key
// (kept in public.business_secrets, readable only by the service role) and confirms the booking.
// Called by /book/done/ after Moyasar redirects back. Never trust the status in the URL.
//
// Body: { booking_id, token, moyasar_id }
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

async function rpc(name: string, p: unknown) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(d?.message || 'rpc'), { code: d?.message || 'SERVER_ERROR' });
  return d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const { booking_id, token, moyasar_id } = await req.json();
    if (!booking_id || !token || !/^[A-Za-z0-9_-]{6,80}$/.test(moyasar_id || '')) {
      return Response.json({ code: 'BAD_INPUT' }, { status: 400, headers: CORS });
    }
    // The token proves the caller is the customer who made this booking.
    await rpc('pub_payment_status', { booking_id, token });
    await rpc('pub_attach_payment', { booking_id, token, moyasar_id });
    const ctx = await rpc('svc_payment_context', { booking_id });
    if (!ctx.secret_key) return Response.json({ code: 'NOT_CONFIGURED' }, { status: 500, headers: CORS });

    const r = await fetch(`https://api.moyasar.com/v1/payments/${encodeURIComponent(moyasar_id)}`, {
      headers: { authorization: `Basic ${btoa(`${ctx.secret_key}:`)}` },
    });
    if (!r.ok) return Response.json({ code: 'NOT_FOUND' }, { status: 404, headers: CORS });
    const pay = await r.json();
    if (pay.metadata?.booking_id && pay.metadata.booking_id !== booking_id) {
      return Response.json({ code: 'NOT_ALLOWED' }, { status: 403, headers: CORS });
    }
    const out = await rpc('svc_confirm_payment', {
      booking_id, moyasar_id, status: pay.status, currency: pay.currency, amount_halalas: pay.amount,
    });
    return Response.json(out, { headers: CORS });
  } catch (e: any) {
    return Response.json({ code: e?.code || 'SERVER_ERROR' }, { status: 400, headers: CORS });
  }
});
