// api/crm.js — AKILOV CRM API (Vercel + Supabase)
// מחזיר גם leads וגם working_flags. Working לא יוצר ליד ב-CRM.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

// CORS: GitHub Pages + כל דומיין vercel.app
function pickAllowOrigin(origin = '') {
  if (!origin) return 'https://chenakilov.github.io';
  try {
    const u = new URL(origin);
    if (u.hostname === 'chenakilov.github.io') return origin;
    if (u.hostname.endsWith('.vercel.app')) return origin;
  } catch {}
  return 'https://chenakilov.github.io';
}

export default async function handler(req, res) {
  const allow = pickAllowOrigin(req.headers.origin);
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const [{ data: leads, error: e1 }, { data: working, error: e2 }] = await Promise.all([
        supabase.from('leads').select('*').order('updated_at', { ascending: false }).limit(1000),
        supabase.from('working_flags').select('*').limit(5000)
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return res.status(200).json({ ok: true, leads, working });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { op } = body;

      if (op === 'add_or_update_lead') {
        const { lead } = body;
        if (!lead || !lead.place_id) return res.status(200).json({ ok: false, error: 'missing place_id' });
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
        return res.status(200).json({ ok: true, lead: row });
      }

      if (op === 'set_stage') {
        const { lead_id, stage } = body;
        if (!lead_id || !stage) return res.status(200).json({ ok: false, error: 'missing params' });
        const { data, error } = await supabase
          .from('leads')
          .update({ stage, updated_at: new Date().toISOString() })
          .eq('id', lead_id)
          .select()
          .limit(1);
        if (error) throw error;
        const row = data[0];
        await supabase.from('lead_actions').insert({ lead_id, action_type: 'stage_changed', payload: { stage } });
        return res.status(200).json({ ok: true, lead: row });
      }

      if (op === 'add_note') {
        const { lead_id, note } = body;
        if (!lead_id || !note) return res.status(200).json({ ok: false, error: 'missing params' });
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
        await supabase.from('lead_actions').insert({ lead_id, action_type: 'note_added', payload: { note } });
        return res.status(200).json({ ok: true, lead: row });
      }

      // === Working flags (לא מוסיף ל-Leads) ===
      // value=true -> upsert ב-working_flags; value=false -> מחיקה מהטבלה
      if (op === 'set_working') {
        const { place_id, value, who } = body;
        if (!place_id) return res.status(200).json({ ok: false, error: 'missing place_id' });

        if (value) {
          const patch = { place_id, is_working: true, marked_by: who || null, marked_at: new Date().toISOString() };
          const { data, error } = await supabase
            .from('working_flags')
            .upsert(patch, { onConflict: 'place_id' })
            .select()
            .limit(1);
          if (error) throw error;
          return res.status(200).json({ ok: true, working: data[0] });
        } else {
          const { error } = await supabase.from('working_flags').delete().eq('place_id', place_id);
          if (error) throw error;
          return res.status(200).json({ ok: true, working: { place_id, is_working: false } });
        }
      }

      if (op === 'delete_lead') {
        const { lead_id } = body;
        if (!lead_id) return res.status(200).json({ ok: false, error: 'missing lead_id' });
        const { data: cur, error: e0 } = await supabase.from('leads').select('id').eq('id', lead_id).limit(1);
        if (e0) throw e0;
        if (!cur || !cur[0]) return res.status(200).json({ ok: false, error: 'not found' });
        const { error } = await supabase.from('leads').delete().eq('id', lead_id);
        if (error) throw error;
        await supabase.from('lead_actions').insert({ lead_id, action_type: 'deleted', payload: {} });
        return res.status(200).json({ ok: true });
      }

      return res.status(200).json({ ok: false, error: 'unknown op' });
    }

    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}
