// api/crm.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

async function getAll() {
  const { data: leads, error: e1 } = await supabase
    .from('leads')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(2000);

  if (e1) throw new Error(e1.message);

  const { data: working, error: e2 } = await supabase
    .from('working')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(5000);

  if (e2) throw new Error(e2.message);

  return { leads, working };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const all = await getAll();
      return res.json({ ok: true, ...all });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { op } = body || {};

      if (op === 'add_or_update_lead') {
        const { lead } = body;
        if (!lead || !lead.place_id) return res.status(400).json({ ok: false, error: 'missing lead/place_id' });
        const now = new Date().toISOString();

        const payload = {
          place_id: lead.place_id,
          name: lead.name || null,
          address: lead.address || null,
          website: lead.website || null,
          phone: lead.phone || null,
          rating: typeof lead.rating === 'number' ? lead.rating : null,
          reviews: typeof lead.reviews === 'number' ? lead.reviews : null,
          categories: lead.categories || null,
          email: lead.email || null,
          enrich_emails: lead.enrich_emails || null,
          enrich_socials: lead.enrich_socials || null,
          updated_at: now
        };

        const { data, error } = await supabase
          .from('leads')
          .upsert(payload, { onConflict: 'place_id' })
          .select()
          .limit(1)
          .maybeSingle();

        if (error) return res.status(500).json({ ok: false, error: error.message });

        // log action
        if (data?.id) {
          await supabase.from('lead_actions').insert({
            lead_id: data.id,
            action_type: 'upsert',
            payload
          });
        }

        return res.json({ ok: true, lead: data });
      }

      if (op === 'set_stage') {
        const { lead_id, stage } = body;
        if (!lead_id || !stage) return res.status(400).json({ ok: false, error: 'missing lead_id/stage' });
        const { data, error } = await supabase
          .from('leads')
          .update({ stage, updated_at: new Date().toISOString() })
          .eq('id', lead_id)
          .select()
          .maybeSingle();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        await supabase.from('lead_actions').insert({ lead_id, action_type: 'stage', payload: { stage } });
        return res.json({ ok: true, lead: data });
      }

      if (op === 'add_note') {
        const { lead_id, note } = body;
        if (!lead_id || !note) return res.status(400).json({ ok: false, error: 'missing lead_id/note' });
        // append note text (simple audit log also exists in lead_actions)
        const { data: cur, error: e0 } = await supabase.from('leads').select('notes').eq('id', lead_id).maybeSingle();
        if (e0) return res.status(500).json({ ok: false, error: e0.message });
        const stamp = new Date().toISOString().replace('T',' ').slice(0,19);
        const notes = ((cur?.notes || '') + (cur?.notes ? '\n' : '') + `[${stamp}] ${note}`).slice(0, 30000);
        const { data, error } = await supabase
          .from('leads')
          .update({ notes, updated_at: new Date().toISOString() })
          .eq('id', lead_id)
          .select()
          .maybeSingle();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        await supabase.from('lead_actions').insert({ lead_id, action_type: 'note', payload: { note } });
        return res.json({ ok: true, lead: data });
      }

      if (op === 'delete_lead') {
        const { lead_id } = body;
        if (!lead_id) return res.status(400).json({ ok: false, error: 'missing lead_id' });
        const { error } = await supabase.from('leads').delete().eq('id', lead_id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.json({ ok: true });
      }

      if (op === 'set_working') {
        const { place_id, value, name, address, lat, lng, country } = body;
        if (!place_id || typeof value === 'undefined') return res.status(400).json({ ok: false, error: 'missing place_id/value' });
        const payload = {
          place_id,
          is_working: !!value,
          name: name || null,
          address: address || null,
          country: country || null,
          lat: typeof lat === 'number' ? lat : null,
          lng: typeof lng === 'number' ? lng : null,
          updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase
          .from('working')
          .upsert(payload, { onConflict: 'place_id' })
          .select()
          .maybeSingle();
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.json({ ok: true, working: data });
      }

      return res.status(400).json({ ok: false, error: 'unknown op' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end('Method Not Allowed');
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
