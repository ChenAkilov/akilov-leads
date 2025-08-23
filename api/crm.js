import { getSupabase } from './_lib/supabase.js';

function cors(res) {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supa = getSupabase();
  const body = req.body || {};
  const action = body.action;

  try {
    if (action === 'list') {
      const { data } = await supa.from('places').select('*');
      // join with leads
      const leadMap = await loadLeadMap(supa);
      const items = (data || []).map(p => ({ ...p, ...(leadMap.get(p.place_id) || {}) }));
      return res.json({ items });
    }

    if (action === 'listWorking') {
      const { data } = await supa
        .from('leads')
        .select('place_id')
        .eq('working', true);
      const ids = (data || []).map(r => r.place_id);
      if (!ids.length) return res.json({ items: [] });
      const { data: places } = await supa.from('places').select('*').in('place_id', ids);
      const leadMap = await loadLeadMap(supa);
      const items = (places || []).map(p => ({ ...p, ...(leadMap.get(p.place_id) || {}) }));
      return res.json({ items });
    }

    if (action === 'upsert') {
      const item = sanitizePlace(body.item || {});
      if (!item.place_id) return res.status(400).json({ error: 'place_id missing' });
      await supa.from('places').upsert(item, { onConflict: 'place_id' });
      await ensureLeadRow(supa, item.place_id);
      return res.json({ ok: true });
    }

    if (action === 'upsertMany') {
      const items = (body.items || []).map(sanitizePlace).filter(i => i.place_id);
      if (!items.length) return res.json({ ok: true, count: 0 });
      await supa.from('places').upsert(items, { onConflict: 'place_id' });
      const ids = items.map(i => ({ place_id: i.place_id }));
      await supa.from('leads').upsert(ids, { onConflict: 'place_id' });
      return res.json({ ok: true, count: items.length });
    }

    if (action === 'setWorking') {
      const { place_id, working } = body;
      if (!place_id) return res.status(400).json({ error: 'place_id missing' });
      await supa.from('leads').upsert({ place_id, working: !!working }, { onConflict: 'place_id' });
      await supa.from('lead_actions').insert({ place_id, action: 'setWorking', payload: { working: !!working } });
      return res.json({ ok: true });
    }

    if (action === 'setStage') {
      const { place_id, stage } = body;
      if (!place_id) return res.status(400).json({ error: 'place_id missing' });
      await supa.from('leads').upsert({ place_id, stage: stage || 'New' }, { onConflict: 'place_id' });
      await supa.from('lead_actions').insert({ place_id, action: 'setStage', payload: { stage } });
      return res.json({ ok: true });
    }

    if (action === 'addNote') {
      const { place_id, note } = body;
      if (!place_id) return res.status(400).json({ error: 'place_id missing' });
      const { data: existing } = await supa.from('leads').select('notes').eq('place_id', place_id).single();
      const newNotes = ((existing?.notes || '') + (existing?.notes ? '\n' : '') + (note || '')).trim();
      await supa.from('leads').upsert({ place_id, notes: newNotes }, { onConflict: 'place_id' });
      await supa.from('lead_actions').insert({ place_id, action: 'addNote', payload: { note } });
      return res.json({ ok: true });
    }

    if (action === 'delete') {
      const { place_id } = body;
      if (!place_id) return res.status(400).json({ error: 'place_id missing' });
      await supa.from('leads').delete().eq('place_id', place_id);
      // Do not delete place automatically - preserve catalog
      await supa.from('lead_actions').insert({ place_id, action: 'deleteLead' });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

function sanitizePlace(p) {
  const allow = ['place_id','name','address','city','state','country','lat','lng','rating','user_ratings_total','website','phone','email','enrich_emails','enrich_socials'];
  const out = {};
  for (const k of allow) if (p[k] != null) out[k] = p[k];
  return out;
}

async function ensureLeadRow(supa, place_id) {
  const { data } = await supa.from('leads').select('place_id').eq('place_id', place_id).maybeSingle?.() || await supa.from('leads').select('place_id').eq('place_id', place_id);
  if (!data || (Array.isArray(data) && data.length === 0)) {
    await supa.from('leads').insert({ place_id });
  }
}

async function loadLeadMap(supa) {
  const { data: leads } = await supa.from('leads').select('*');
  const m = new Map();
  for (const l of leads || []) m.set(l.place_id, l);
  return m;
}
