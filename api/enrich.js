// api/enrich.js
// Simple email/social enrichment by crawling a few common pages.
// NOTE: Keep timeouts modest to avoid slow requests.

const PAGES = ['', 'contact', 'contacts', 'about', 'team', 'impressum', 'legal', 'wholesale'];

function uniq(arr){ return Array.from(new Set(arr.filter(Boolean))); }

function scoreEmail(e){
  const s = e.toLowerCase();
  let score = 1;
  if (/@(gmail|yahoo|outlook|hotmail)\./.test(s)) score -= 1;             // generic mailbox
  if (/info@|contact@|sales@|hello@/.test(s)) score += 2;                 // generic company
  if (/wholesale@|b2b@|partnerships@|bizdev@|distributor@/.test(s)) score += 5;
  if (/procure|purchas|buyer|category|sourcing/.test(s)) score += 8;      // buyer/procurement
  if (/marketing|growth|bd@|bizdev@/.test(s)) score += 4;                 // marketing/bizdev
  if (/ceo@|cto@|founder@|owner@/.test(s)) score += 3;
  if (/\.(png|jpg|jpeg|gif|svg)$/i.test(s)) score -= 3;                    // false positives
  return score;
}

function extractEmails(html){
  const mailtos = [...html.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})/gi)].map(m=>m[1]);
  const plain = [...html.matchAll(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})\b/g)].map(m=>m[1]);
  return uniq([...mailtos, ...plain]);
}
function extractSocials(html, base){
  function abs(u){ try{ return new URL(u, base).toString(); }catch{ return null; } }
  const lk = [...html.matchAll(/https?:\/\/(www\.)?linkedin\.com\/[^\s"'<>]+/gi)].map(m=>abs(m[0]));
  const ig = [...html.matchAll(/https?:\/\/(www\.)?instagram\.com\/[^\s"'<>]+/gi)].map(m=>abs(m[0]));
  const fb = [...html.matchAll(/https?:\/\/(www\.)?facebook\.com\/[^\s"'<>]+/gi)].map(m=>abs(m[0]));
  const socials = {};
  if (lk.length) socials.linkedin = lk[0];
  if (ig.length) socials.instagram = ig[0];
  if (fb.length) socials.facebook = fb[0];
  return socials;
}

export default async function handler(req, res) {
  try {
    const url = (req.query.url || '').trim();
    if (!url) return res.status(400).json({ ok:false, error:'missing url' });

    const seen = new Set();
    const results = [];
    let socials = {};

    const controller = new AbortController();
    const TIMEOUT_MS = 8000;
    const timer = setTimeout(()=>controller.abort(), TIMEOUT_MS);

    for (const slug of PAGES) {
      let u = url;
      try {
        const base = new URL(url);
        if (slug) u = new URL(slug, base.origin + '/').toString();
        if (seen.has(u)) continue;
        seen.add(u);

        const resp = await fetch(u, { signal: controller.signal, headers: { 'user-agent':'Mozilla/5.0 (compatible; AKILOV/1.0)' } });
        if (!resp.ok) continue;
        const html = await resp.text();

        const emails = extractEmails(html);
        for (const e of emails) results.push(e);
        if (!socials.linkedin || !socials.instagram || !socials.facebook) {
          const s = extractSocials(html, u);
          socials = { ...socials, ...s };
        }

        if (results.length > 20) break; // enough
      } catch(e) { /* ignore page errors */ }
    }

    clearTimeout(timer);

    const unique = uniq(results);
    const ranked = unique
      .map(email => ({ email, score: scoreEmail(email) }))
      .sort((a,b)=>b.score-a.score);

    const best = ranked[0]?.email || null;
    return res.json({ ok:true, best_email: best, emails_ranked: ranked, socials });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message || String(e) });
  }
}
