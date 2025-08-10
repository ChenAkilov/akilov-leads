// api/crm.js — REST קטן ל-CRM: הוספה/עדכון לידים, שינוי שלב, הוספת הערה, לוג פעולות
import { createClient } from '@supabase/supabase-js';

// חשוב: את שני המשתנים האלה מגדירים ב-Vercel → Project → Settings → Environment Variables
// SUPABASE_URL          = ה-Project URL של Supabase (נראה כמו https://xxxx.supabase.co)
// SUPABASE_SERVICE_ROLE = ה-Service Role Key (סודי, שרת בלבד!)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

// לאפשר קריאות מהאתר שלך ב-GitHub Pages
const ALLOW_ORIGIN = 'https://chenakilov.github.io';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // החזרת רשימת לידים (עד 500)
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return res.status(200).json({ ok: true, leads: data });
    }

    if (req.method === 'POST') {
      const { op, lead, lead_id, stage, note, action_type, payload } = req.body || {};

      // יצירה/עדכון ליד לפי place_id (כדי לא ליצור כפילויות)
      if (op === 'add_or_update_lead') {
        if (!lead || !lead.place_id) {
          return res.status(400).json({ ok:false, error:'missing place_id' });
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
          // שדות העשרה (כולל ה-best email)
          email: lead.email || null,
          enrich_emails: lead.enrich_emails || null,   // JSON (רשימת מיילים מדורגת)
          enrich_socials: lead.enrich_socials || null, // JSON (linkedin/instagram/facebook)
          updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('leads')
          .upsert(upsert, { onConflict: 'place_id' })
          .select()
          .limit(1);
        if (error) throw error;

        // לוג פעולה
        await supabase.from('lead_actions').insert({
          lead_id: data[0].id,
          action_type: 'created_or_updated',
          payload: upsert
        });

        return res.status(200).json({ ok:true, lead:data[0] });
      }

      // שינוי שלב (Pipeline)
      if (op === 'set_stage') {
        if (!lead_id || !stage) {
          return res.status(400).json({ ok:false, error:'missing params' });
        }
        const { data, error } = await supabase
          .from('leads')
          .update({ stage, updated_at: new Date().toISOString() })
          .eq('id', lead_id)
          .select()
          .limit(1);
        if (error) throw error;

        await supabase.from('lead_actions').insert({
          lead_id, action_type:'stage_changed', payload:{ stage }
        });

        return res.status(200).json({ ok:true, lead: data[0] });
      }

      // הוספת הערה חופשית
      if (op === 'add_note') {
        if (!lead_id || !note) {
          return res.status(400).json({ ok:false, error:'missing params' });
        }
        const { data: cur, error: e1 } = await supabase
          .from('leads')
          .select('notes')
          .eq('id', lead_id)
          .limit(1);
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

        await supabase.from('lead_actions').insert({
          lead_id, action_type:'note_added', payload:{ note }
        });

        return res.status(200).json({ ok:true, lead: data[0] });
      }

      // לוג פעולה חופשית (למשל: emailed, enriched, called)
      if (op === 'log') {
        if (!lead_id || !action_type) {
          return res.status(400).json({ ok:false, error:'missing params' });
        }
        await supabase.from('lead_actions').insert({
          lead_id, action_type, payload: payload || {}
        });
        return res.status(200).json({ ok:true });
      }

      return res.status(400).json({ ok:false, error:'unknown op' });
    }

    return res.status(405).json({ ok:false, error:'method not allowed' });
  } catch (e) {
    return res.status(200).json({ ok:false, error: String(e && e.message || e) });
  }
}
