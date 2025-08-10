// api/crm.js — AKILOV CRM API (Vercel + Supabase)
// פעולות: get leads, add_or_update_lead, set_stage, add_note, set_working, delete_lead

import { createClient } from '@supabase/supabase-js';

// === ENV (ב-Vercel → Project → Settings → Environment Variables) ===
// SUPABASE_URL           -> https://xxxxx.supabase.co
// SUPABASE_SERVICE_ROLE  -> service role key (לא להפיץ לצד לקוח!)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

// === CORS ===
// מאפשר github pages והדומיין של vercel (כולל preview domains)
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
      // החזרה של עד 1000 לידים, ממוינים לפי עדכון אחרון
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return res.status(200).json({ ok: true, leads: data });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { op } = body;

      // ליצור/לעדכן ליד (מזהה עיקרי place_id)
      if (op === 'add_or_update_lead') {
        const { lead } = body;
        if (!lead || !lead.place_id) {
          return res.status(200).json({ ok: false, error: 'missing place_id' });
        }
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

      // שינוי סטטוס (Stage)
      if (op === 'set_stage') {
        const { lead_id, stage } = body;
        if (!lead_id || !stage) {
          return res.status(200).json({ ok: false, error: 'missing params' });
        }
        const { data, error } = await supabase
          .from('leads')
          .update({ stage, updated_at: new Date().toISOString() })
          .eq('id', lead_id)
          .select()
          .limit(1);
        if (error) throw error;
        const row = data[0];
        await supabase.from('lead_actions').insert({
          lead_id, action_type: 'stage_changed', payload: { stage }
        });
        return res.status(200).json({ ok: true, lead: row });
      }

      // הוספת הערה (Notes)
      if (op === 'add_note') {
        const { lead_id, note } = body;
        if (!lead_id || !note) {
          return res.status(200).json({ ok: false, error: 'missing params' });
        }
        const { data: cur, error: e1 } = await supabase
          .from('leads').select('notes').eq('id', lead_id).limit(1);
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
        await supabase.from('lead_actions').insert({
          lead_id, action_type: 'note_added', payload: { note }
        });
        return res.status(200).json({ ok: true, lead: row });
      }

      // סימון/ביטול Working (מסונכרן לכולם)
      // אפשר לשלוח lead_id או place_id; אופציונלי: who (שם הסוכן)
      if (op === 'set_working') {
        const { lead_id, place_id, value, who } = body;
        if (!lead_id && !place_id) {
          return res.status(200).json({ ok: false, error: 'missing lead_id or place_id' });
        }
        const patch = {
          is_working: !!value,
          working_by: who || null,
          working_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

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

        await supabase.from('lead_actions').insert({
          lead_id: row.id, action_type: 'set_working', payload: { value: !!value, who: who || null }
        });
        return res.status(200).json({ ok: true, lead: row });
      }

      // מחיקת ליד
      if (op === 'delete_lead') {
        const { lead_id } = body;
        if (!lead_id) {
          return res.status(200).json({ ok: false, error: 'missing lead_id' });
        }
        const { data: cur, error: e0 } = await supabase
          .from('leads').select('id').eq('id', lead_id).limit(1);
        if (e0) throw e0;
        if (!cur || !cur[0]) {
          return res.status(200).json({ ok: false, error: 'not found' });
        }
        const { error } = await supabase.from('leads').delete().eq('id', lead_id);
        if (error) throw error;
        await supabase.from('lead_actions').insert({
          lead_id, action_type: 'deleted', payload: {}
        });
        return res.status(200).json({ ok: true });
      }

      return res.status(200).json({ ok: false, error: 'unknown op' });
    }

    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}
