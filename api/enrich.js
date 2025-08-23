import { getSupabase } from './_lib/supabase.js';

const SOCIAL_PATTERNS = [
  /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.-]+/gi,
  /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.-]+/gi,
  /https?:\/\/(?:www\.)?tiktok\.com\/[A-Za-z0-9_.-]+/gi,
  /https?:\/\/(?:www\.)?pinterest\.com\/[A-Za-z0-9_.-]+/gi,
  /https?:\/\/(?:www\.)?linkedin\.com\/[A-Za-z0-9_\/-]+/gi
];

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
    const { items = [] } = req.body || {};
    const out = [];

    for (const it of items) {
      const enriched = { ...it, enrich_emails: toArr(it.enrich_emails), enrich_socials: toArr(it.enrich_socials) };
      const website = it.website || '';

      // Try fetching the website to grab emails and socials
      if (website && /^https?:\/\//i.test(website)) {
        try {
          const html = await fetch(website, { redirect: 'follow' }).then(r => r.text());
          const foundEmails = Array.from(new Set([...(html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])]))
            .filter(x => !x.endsWith('@example.com'))
            .slice(0, 5);
          const foundSocials = new Set(enriched.enrich_socials);
          for (const re of SOCIAL_PATTERNS) {
            const m = html.match(re) || [];
            m.forEach(u => foundSocials.add(cleanUrl(u)));
          }
          enriched.enrich_emails = uniqueAppend(enriched.enrich_emails, foundEmails).slice(0, 10);
          enriched.enrich_socials = Array.from(foundSocials).slice(0, 10);
          if (!enriched.email && enriched.enrich_emails.length) enriched.email = enriched.enrich_emails[0];
        } catch (_) {
          // ignore fetch errors
        }
      } else if (it.name && it.city) {
        // Simple fallback guess when no website exists
        const guess = guessDomainFromName(it.name);
        if (guess) {
          const probable = [`info@${guess}`, `contact@${guess}`, `sales@${guess}`];
          enriched.enrich_emails = uniqueAppend(enriched.enrich_emails, probable);
          if (!enriched.email) enriched.email = enriched.enrich_emails[0];
        }
      }

      out.push(enriched);
    }

    // Optional: persist enrichment to DB when place_id exists
    try {
      const supa = getSupabase();
      const rows = out.filter(x => x.place_id).map(x => ({ place_id: x.place_id, email: x.email || null, enrich_emails: x.enrich_emails || [], enrich_socials: x.enrich_socials || [] }));
      if (rows.length) await supa.from('places').upsert(rows, { onConflict: 'place_id' });
    } catch (_) {}

    return res.json({ items: out });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

function toArr(x) { return Array.isArray(x) ? x : x ? [x] : []; }
function uniqueAppend(a, b) { const s = new Set(a); for (const x of b) s.add(x); return Array.from(s); }
function cleanUrl(u) { try { const url = new URL(u); url.hash = ''; url.search = ''; return url.toString(); } catch { return u; } }
function guessDomainFromName(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return '';
  return slug + '.com';
}
