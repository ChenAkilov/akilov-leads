// api/crm.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

// ===== CORS =====
function pickAllowOrigin(origin = '') {
  if (!origin) return 'https://chenakilov.github.io';
  try {
    const u = new URL(origin);
    if (u.hostname === 'chenakilov.github.io') return origin;
    if (u.hostname.endsWith('.vercel.app')) return origin;
  } catch {}
  return 'https://chenakilov.github.io';
}
function setCors(res, origin) {
  const allow = pickAllowOrigin(origin);
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ===== helpers =====
const nowISO = () => new Date().toISOString();
const clean = (v) => (v === undefined ? undefined : v);

function buildLeadPatch(input = {}) {
  // נכניס רק שדות שנשלחו – כדי לא לדרוס נתונים קיימים בריק
  const p = {};
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '') p[k] = v; };

  put('place_id', input.place_id);
  put('name', input.name);
  put('address', input.address);
  put('website', input.website);
  put('phone', input.phone);
  put('rating', input.rating);
  put('reviews', input.reviews);
  put('categories', input.categories);
  put('email', input.email);
  if (input.enrich_emails !== undefined) p.enrich_emails = input.enrich_emails; // jsonb
  if (input.enrich_socials !== undefined) p.enrich_socials = input.enrich_socials; // jsonb
  p.updated_at = nowISO();
  return p;
}

async function appendAction(lead_id, action_type, payload = {}) {
  try {
    await supabase.from('lead_actions').insert({ lead_id, action_type, payload });
  } catch {}
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // מחזיר רשימות למסכים: CRM + Maps
      const [leadsQ, workQ] = await Promise.all([
        supabase
          .from('leads')
          .select('id,place_id,name,address,website,phone,rating,reviews,categories,email,stage,notes,created_at,updated_at')
          .order('updated_at', { ascending: false }),
        supabase
          .from('working_flags')
          .select('place_id,is_working,marked_by,marked_at,name,address,lat,lng,country')
      ]);

      if (leadsQ.error) throw leadsQ.error;
      if (workQ.error) throw workQ.error;

      return res.status(200).json({
        ok: true,
        leads: leadsQ.data || [],
        working: (workQ.data || []).filter(r => r.is_working !== false)
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method not allowed' });
    }

    // POST ops
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const op = body.op;

    // --- add_or_update_lead ---
    if (op === 'add_or_update_lead') {
      const lead = body.lead || {};
      if (!lead.place_id) return res.status(200).json({ ok: false, error: 'missing place_id' });

      const patch = buildLeadPatch(lead);

      // upsert לפי place_id
      const { data, error } = await supabase
        .from('leads')
        .upsert(patch, { onConflict: 'place_id' })
        .select()
        .limit(1);

      if (error) throw error;

      const saved = data?.[0];
      if (saved) await appendAction(saved.id, 'upsert', { fields: Object.keys(patch) });

      return res.status(200).json({ ok: true, lead: saved });
    }

    // --- set_stage ---
    if (op === 'set_stage') {
      const { lead_id, stage } = body;
      if (!lead_id || !stage) return res.status(200).json({ ok: false, error: 'missing lead_id/stage' });

      const { data, error } = await supabase
        .from('leads')
        .update({ stage, updated_at: nowISO() })
        .eq('id', lead_id)
        .select()
        .limit(1);

      if (error) throw error;
      const saved = data?.[0];
      if (saved) await appendAction(lead_id, 'set_stage', { stage });

      return res.status(200).json({ ok: true, lead: saved });
    }

    // --- add_note ---
    if (op === 'add_note') {
      const { lead_id, note } = body;
      if (!lead_id || !note) return res.status(200).json({ ok: false, error: 'missing lead_id/note' });

      // משיכת notes קיים כדי לצרף
      const cur = await supabase.from('leads').select('notes').eq('id', lead_id).limit(1);
      if (cur.error) throw cur.error;

      const prev = cur.data?.[0]?.notes ? `${cur.data[0].notes}\n` : '';
      const line = `• ${new Date().toLocaleString()} — ${note}`;
      const { data, error } = await supabase
        .from('leads')
        .update({ notes: prev + line, updated_at: nowISO() })
        .eq('id', lead_id)
        .select()
        .limit(1);

      if (error) throw error;
      const saved = data?.[0];
      if (saved) await appendAction(lead_id, 'add_note', { note_len: note.length });

      return res.status(200).json({ ok: true, lead: saved });
    }

    // --- delete_lead ---
    if (op === 'delete_lead') {
      const { lead_id } = body;
      if (!lead_id) return res.status(200).json({ ok: false, error: 'missing lead_id' });

      const { error } = await supabase.from('leads').delete().eq('id', lead_id);
      if (error) throw error;

      await appendAction(lead_id, 'delete', {});
      return res.status(200).json({ ok: true });
    }

    // --- set_working ---
    if (op === 'set_working') {
      const { place_id, value, who, name, address, lat, lng, country } = body;
      if (!place_id) return res.status(200).json({ ok: false, error: 'missing place_id' });

      if (value) {
        const patch = {
          place_id,
          is_working: true,
          marked_by: clean(who) || null,
          marked_at: nowISO()
        };
        if (name !== undefined) patch.name = name;
        if (address !== undefined) patch.address = address;
        if (typeof lat === 'number' && typeof lng === 'number') { patch.lat = lat; patch.lng = lng; }
        if (country !== undefined) patch.country = country;

        const { data, error } = await supabase
          .from('working_flags')
          .upsert(patch, { onConflict: 'place_id' })
          .select()
          .limit(1);

        if (error) throw error;
        await appendAction(null, 'set_working', { place_id, is_working: true });

        return res.status(200).json({ ok: true, working: data?.[0] || null });
      } else {
        const { error } = await supabase.from('working_flags').delete().eq('place_id', place_id);
        if (error) throw error;
        await appendAction(null, 'set_working', { place_id, is_working: false });
        return res.status(200).json({ ok: true, working: { place_id, is_working: false } });
      }
    }

    return res.status(200).json({ ok: false, error: 'unknown op' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}
