// api/enrich.js
// שולף מיילים+חברתיים, מדרג מייל "הכי מתאים" (Buyer/Wholesale/Marketing קודם), Hunter.io אופציונלי
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://chenakilov.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = (req.query.url || '').trim();
    if (!url) return res.status(400).json({ error: 'Missing ?url=' });

    const html = await fetchSafe(url);
    const contactHref = findContactLink(html, url);
    const contactHtml = contactHref ? (await fetchSafe(contactHref)) : '';

    const baseData = extractAll(html, url);
    const contactData = extractAll(contactHtml || '', contactHref || '');

    // איחוד
    let emails = dedupEmails([...(baseData.emails||[]), ...(contactData.emails||[])]);
    const socials = mergeSocials(baseData.socials, contactData.socials);

    // דירוג מיילים
    const ranked = rankEmails(emails, html, contactHtml, url);
    let best_email = ranked[0]?.email || '';

    // Hunter.io (אופציונלי) אם אין מייל טוב
    if (!goodEnough(best_email) && process.env.HUNTER_API_KEY) {
      const domain = getDomain(url);
      const hunter = await hunterDomainSearch(domain);
      if (hunter?.emails?.length) {
        const hunterRanked = rankEmails(hunter.emails.map(e=>e.value), '', '', url);
        if (hunterRanked.length && (scoreOf(hunterRanked[0]) > scoreOf(ranked[0]||{}))) {
          best_email = hunterRanked[0].email;
          // מיזוג לרשימה
          emails = dedupEmails(emails.concat(hunter.emails.map(e=>e.value)));
          ranked.unshift(hunterRanked[0]); // שים למעלה אם טוב יותר
        }
      }
    }

    return res.status(200).json({
      source: url,
      contact_page: contactHref || '',
      best_email,
      emails_ranked: ranked,        // [{email, score, reason}]
      emails_all: emails,           // כל המיילים שנמצאו
      socials
    });
  } catch (e) {
    return res.status(200).json({ error: String(e && e.message || e) });
  }
}

/* ---------------- helpers ---------------- */
function empty(){ return { emails:[], socials:{linkedin:'',instagram:'',facebook:''} } }

async function fetchSafe(u){
  try {
    const r = await fetch(u, { headers: { 'user-agent':'Mozilla/5.0 AKILOV-Enrich' } });
    if (!r.ok) return '';
    const text = await r.text();
    return text.slice(0, 2_000_000);
  } catch { return '' }
}
function absolute(base, href){ try{ if(!href) return ''; return new URL(href, base).toString(); }catch{ return '' } }
function getDomain(u){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch{ return '' } }

function findContactLink(html, baseUrl){
  if(!html) return '';
  const re = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([^<]{0,160})<\/a>/gi;
  let m;
  const keys = ['contact','contacts','contact-us','support','about','אודות','יצירת קשר','צור קשר','team','staff'];
  while ((m = re.exec(html)) !== null){
    const href = (m[1]||'').trim();
    const text = (m[2]||'').toLowerCase();
    if (keys.some(k => href.toLowerCase().includes(k) || text.includes(k))) {
      return absolute(baseUrl, href);
    }
  }
  return '';
}

function extractAll(html, baseUrl){
  if(!html) return empty();
  const emails = dedupEmails(
    (html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/g) || [])
      .filter(e => !/\.(png|jpg|jpeg|gif)$/i.test(e))
  ).slice(0, 80);

  const socials = {
    linkedin: firstMatchUrl(html, /(https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[^\s"'<>]+)/i, baseUrl),
    instagram: firstMatchUrl(html, /(https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._-]+)/i, baseUrl),
    facebook: firstMatchUrl(html, /(https?:\/\/(www\.)?facebook\.com\/[A-Za-z0-9._-]+)/i, baseUrl),
  };

  return { emails, socials };
}
function firstMatchUrl(html, regex, baseUrl){
  const m = html && html.match(regex);
  return m && m[0] ? absolute(baseUrl, m[0]) : '';
}
function dedupEmails(arr){
  const seen = new Set(); const out=[];
  for(const e of arr){ const v=e.toLowerCase(); if(!seen.has(v)){ seen.add(v); out.push(e); } }
  return out;
}

const HIGH = ['procurement','purchasing','buyer','buying','sourcing','wholesale','b2b','sales','partnership','partnerships','bizdev','business.development'];
const MID  = ['marketing','brand','pr','press','collab'];
const LOW  = ['info','support','office','hello','contact'];

function rankEmails(emails, html1, html2, baseUrl){
  const text = (html1||'') + '\n' + (html2||'');
  const around = (email)=>{
    if(!text) return '';
    const i = text.indexOf(email);
    if(i<0) return '';
    const start = Math.max(0,i-160), end = Math.min(text.length, i+160);
    return text.slice(start,end).toLowerCase();
  };
  const items = [];
  for(const e of emails){
    const eLower = e.toLowerCase();
    const user = eLower.split('@')[0];
    let score = 0; let reason = [];

    // תחילית לפי user
    if (HIGH.some(k => user.includes(k))) { score+=80; reason.push('procurement/wholesale/sales keyword'); }
    else if (MID.some(k => user.includes(k))) { score+=55; reason.push('marketing/brand keyword'); }
    else if (LOW.some(k => user === k || user.startsWith(k))) { score+=10; reason.push('generic'); }
    else if (user.includes('.')) { score+=35; reason.push('firstname.lastname pattern'); }
    else { score+=20; reason.push('other'); }

    // בונוס לפי טקסט סביב המייל
    const ctx = around(e);
    if (ctx) {
      if (HIGH.some(k => ctx.includes(k))) { score+=40; reason.push('context: procurement/wholesale'); }
      else if (MID.some(k => ctx.includes(k))) { score+=20; reason.push('context: marketing'); }
    }

    // ענישה לדומיינים כלליים (gmail/yahoo) אם יש דומיין חברה
    const domain = eLower.split('@')[1]||'';
    const siteDomain = getDomain(baseUrl);
    if (siteDomain && domain !== siteDomain && !domain.endsWith('.'+siteDomain)) {
      if (/gmail\.com|yahoo\.com|outlook\.com|hotmail\.com/i.test(domain)) {
        score -= 10; reason.push('free mail domain');
      }
    }

    items.push({ email: e, score, reason: reason.join(', ') });
  }
  items.sort((a,b)=> b.score - a.score);
  return items;
}
function scoreOf(x){ return typeof x?.score === 'number' ? x.score : -1; }
function goodEnough(email){ if(!email) return false; const u = email.split('@')[0].toLowerCase(); return HIGH.some(k=>u.includes(k)) || u.includes('.') }

function mergeSocials(a={}, b={}){
  return {
    linkedin: b.linkedin || a.linkedin || '',
    instagram: b.instagram || a.instagram || '',
    facebook: b.facebook || a.facebook || ''
  };
}

/* ---- Hunter.io (optional) ---- */
async function hunterDomainSearch(domain){
  try{
    if(!domain) return null;
    const key = process.env.HUNTER_API_KEY;
    if(!key) return null;
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${key}`;
    const r = await fetch(url);
    if(!r.ok) return null;
    const j = await r.json();
    // מחזיר emails: [{value, type, position, confidence}]
    return j?.data || null;
  }catch{ return null }
}
