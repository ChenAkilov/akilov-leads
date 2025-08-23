import { getSupabase } from './_lib/supabase.js';
import { textSearch, placeDetails, toPlaceRow } from './_lib/google.js';

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
  try {
    const { q, category, buyerType, region, state, city, limit = 40, refresh = false, enrich = false } = req.body || {};

    const queryText = q && q.trim() ? q.trim() : buildQuery({ category, buyerType, region, state, city });
    const googleResults = await textSearch(queryText, region);

    // Pull details for each place to get website and address components
    const detailed = [];
    for (const r of googleResults.slice(0, limit)) {
      try {
        const d = await placeDetails(r.place_id);
        detailed.push(toPlaceRow(d));
        await sleep(80);
      } catch (e) {
        // skip on error
      }
    }

    if (!refresh) return res.json({ items: detailed, query: queryText });

    // Refresh path: upsert to DB and optionally enrich
    const supa = getSupabase();
    const { data: up } = await supa
      .from('places')
      .upsert(detailed, { onConflict: 'place_id' })
      .select();

    // Log query mapping
    if (queryText) {
      const rows = up?.map(p => ({ query: queryText, place_id: p.place_id })) || [];
      if (rows.length) await supa.from('query_places').insert(rows).select();
    }

    let items = up || detailed;
    if (enrich && items.length) {
      // call internal enrich API to augment
      const enr = await fetch(new URL('./enrich', `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/`).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items })
      }).then(r => r.json()).catch(() => ({ items }));
      items = enr.items || items;

      // Persist enrichment
      const toMerge = items.map(i => ({ place_id: i.place_id, email: i.email || null, enrich_emails: i.enrich_emails || [], enrich_socials: i.enrich_socials || [] }));
      await supa.from('places').upsert(toMerge, { onConflict: 'place_id' });
    }

    return res.json({ items, query: queryText, refreshed: true, enriched: !!enrich });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildQuery({ category, buyerType, region, state, city }) {
  const cat = category === 'judaica' ? 'judaica' : 'home and kitchen';
  const buyer = buyerType === 'wholesale' ? 'wholesale distributor' : 'store';
  const parts = [cat, buyer];
  if (city) parts.push('in ' + city);
  if (state) parts.push(state);
  parts.push(region === 'IL' ? 'Israel' : region === 'US' ? 'USA' : 'Europe');
  return parts.filter(Boolean).join(' ');
}
