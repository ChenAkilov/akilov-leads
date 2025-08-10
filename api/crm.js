// api/crm.js — REST for AKILOV CRM (Supabase). add/update, stage, note, delete, set_working.
import { createClient } from '@supabase/supabase-js';

// ENV on Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

// CORS (התאם אם יש דומיינים נוספים)
const ALLOW_ORIGINS = new Set([
  'https://chenakilov.github.io',
  'https://akilov-leads.vercel.app'
]);

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allow = ALLOW_ORIGINS.has(origin) ? origin : 'https://chenakilov.github.io';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return res.status(200).json({ ok: true, leads: data });
    }

    if (req.method === 'POST') {
      const { op, lead, lead_id, stage, note, place_id, value } = req.body || {};

      if (op === 'add_or_update_lead') {
        if (!lead || !lead.place_id) return res.status(200).json({ ok:false, error:'missing place_id' });
        const upsert = {
          place_id: lead.place_id,
          name: lead.name || null,
          address: lead.address || null,
          website: lead.website || null,
          phone: lead.phone || null,
          rating: lead.rating ?? null,
          reviews: lead.reviews ?? null,
          categories: lead.categories || null,
          email: lead.email || null,
          enrich_emails: lead.enrich_emails || null,
          enrich_socials: lead.enrich_socials || null,
          updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase
          .from('leads')
          .upsert(upsert, { onConflict: 'place_id' })
          .select()
          .limit(1);
        if (error) throw error;
        const row = data[0];
        await supabase.from('lead_actions').insert({
          lead_id: row.id, action_type: 'created_or_updated', payload: upsert
        });
        return res.status(200).json({ ok:true, lead: row });
      }

      if (op === 'set_stage') {
        if (!lead_id || !stage) return res.status(200).json({ ok:false, error:'missing params' });
        const { data, error } = await supabase
          .from('leads')
          .update({ stage, updated_at: new Date().toISOString() })
          .eq('id', lead_id)
          .select()
          .limit(1);
        if (error) throw error;
        const row = data[0];
        await supabase.from('lead_actions').insert({ lead_id, action_type:'stage_changed', payload:{ stage } });
        return res.status(200).json({ ok:true, lead: row });
      }

      if (op === 'add_note') {
        if (!lead_id || !note) return res.status(200).json({ ok:false, error:'missing params' });
        const { data: cur, error: e1 } = await supabase.from('leads').select('notes').eq('id', lead_id).limit(1);
        if (e1) throw e1;
        const prev = (cur && cur[0] && cur[0].notes) ? cur[0].notes + '\n' : '';
        const txt = prev + `• ${new Date().toLocaleString()} — ${note}`;
        const { data, error } = await supabase
          .from('leads')
          .update({ notes: txt, updated_at: new Date().toISOString() })
          .eq('id', lead_id)
          .select()
          .limit(1);
        if (error) throw error;
        const row = data[0];
        await supabase.from('lead_actions').insert({ lead_id, action_type:'note_added', payload:{ note } });
        return res.status(200).json({ ok:true, lead: row });
      }

      // NEW: set_working (by lead_id OR by place_id; upsert if needed)
      if (op === 'set_working') {
        if (!lead_id && !place_id) return res.status(200).json({ ok:false, error:'missing lead_id or place_id' });
        const patch = { is_working: !!value, working_at: new Date().toISOString(), updated_at: new Date().toISOString() };

        let row;
        if (lead_id) {
          const { data, error } = await supabase
            .from('leads')
            .update(patch)
            .eq('id', lead_id)
            .select()
            .limit(1);
          if (error) throw error;
          row = data[0];
        } else {
          const { data, error } = await supabase
            .from('leads')
            .upsert({ place_id, ...patch }, { onConflict: 'place_id' })
            .select()
            .limit(1);
          if (error) throw error;
          row = data[0];
        }
        await supabase.from('lead_actions').insert({ lead_id: row.id, action_type:'set_working', payload:{ value: !!value } });
        return res.status(200).json({ ok:true, lead: row });
      }

      if (op === 'delete_lead') {
        if (!lead_id) return res.status(200).json({ ok:false, error:'missing lead_id' });
        const { data: cur, error: e0 } = await supabase.from('leads').select('id').eq('id', lead_id).limit(1);
        if (e0) throw e0;
        if (!cur || !cur[0]) return res.status(200).json({ ok:false, error:'not found' });
        const { error } = await supabase.from('leads').delete().eq('id', lead_id);
        if (error) throw error;
        await supabase.from('lead_actions').insert({ lead_id, action_type:'deleted', payload:{} });
        return res.status(200).json({ ok:true });
      }

      return res.status(200).json({ ok:false, error:'unknown op' });
    }

    return res.status(405).json({ ok:false, error:'method not allowed' });
  } catch (e) {
    return res.status(200).json({ ok:false, error: String(e && e.message || e) });
  }
}
