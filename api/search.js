import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
      const { category, country, scope } = req.query;
      if (!category || !country || typeof scope === 'undefined') {
        return res.status(400).json({ ok: false, error: 'missing params' });
      }

      const { data, error } = await supabase
        .from('query_places')
        .select('place_id, places:places!inner(*)')
        .eq('category', category)
        .eq('country', country)
        .eq('scope', scope)
        .order('last_seen_at', { referencedTable: 'places', ascending: false })
        .limit(2000);

      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.json({ ok: true, places: (data || []).map(r => r.places) });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (body?.op !== 'upsert_many') {
        return res.status(400).json({ ok: false, error: 'bad op' });
      }
      const { query, items } = body;
      if (!query || !Array.isArray(items)) {
        return res.status(400).json({ ok: false, error: 'bad payload' });
      }

      const nowIso = new Date().toISOString();
      const toUpsert = items.map(x => ({
        place_id: x.place_id,
        name: x.name || null,
        address: x.address || null,
        country: x.country || null,
        phone: x.phone || null,
        website: x.website || null,
        rating: typeof x.rating === 'number' ? x.rating : null,
        reviews: typeof x.reviews === 'number' ? x.reviews : null,
        categories: x.categories || null,
        business_status: x.business_status || null,
        lat: typeof x.lat === 'number' ? x.lat : null,
        lng: typeof x.lng === 'number' ? x.lng : null,
        last_seen_at: nowIso
      }));

      const { error: upErr } = await supabase.from('places').upsert(toUpsert, { onConflict: 'place_id' });
      if (upErr) return res.status(500).json({ ok: false, error: upErr.message });

      const links = items.map(x => ({
        category: query.category, country: query.country, scope: query.scope, place_id: x.place_id
      }));
      const { error: linkErr } = await supabase
        .from('query_places')
        .upsert(links, { onConflict: 'category,country,scope,place_id', ignoreDuplicates: true });
      if (linkErr) return res.status(500).json({ ok: false, error: linkErr.message });

      return res.json({ ok: true, upserted: items.length });
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).end('Method Not Allowed');
  } catch (e) {
    console.error('SEARCH API ERROR:', e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
