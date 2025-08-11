const PAGES = ['', 'contact', 'contacts', 'about', 'team', 'impressum', 'legal', 'wholesale'];
function uniq(a){ return Array.from(new Set(a.filter(Boolean))); }
function setCors(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); }

function scoreEmail(e){
  const s=e.toLowerCase(); let sc=1;
  if (/@(gmail|yahoo|outlook|hotmail)\./.test(s)) sc -= 1;
  if (/info@|contact@|sales@|hello@/.test(s)) sc += 2;
  if (/wholesale@|b2b@|partnerships@|bizdev@|distributor@/.test(s)) sc += 5;
  if (/procure|purchas|buyer|category|sourcing/.test(s)) sc += 8;
  if (/marketing|growth|bd@|bizdev@/.test(s)) sc += 4;
  if (/ceo@|cto@|founder@|owner@/.test(s)) sc += 3;
  if (/\.(png|jpg|jpeg|gif|svg)$/i.test(s)) sc -= 3;
  return sc;
}
function extractEmails(html){
  const mailtos=[...html.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})/gi)].map(m=>m[1]);
  const plain=[...html.matchAll(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})\b/g)].map(m=>m[1]);
  return uniq([...mailtos,...plain]);
}
function extractSocials(html, base){
  function abs(u){ try{ return new URL(u, base).toString(); }catch{ return null; } }
  const lk=[...html.matchAll(/https?:\/\/(www\.)?linkedin\.com\/[^\s"'<>]+/gi)].map(m=>abs(m[0]));
  const ig=[...html.matchAll(/https?:\/\/(www\.)?instagram\.com\/[^\s"'<>]+/gi)].map(m=>abs(m[0]));
  const fb=[...html.matchAll(/https?:\/\/(www\.)?facebook\.com\/[^\s"'<>]+/gi)].map(m=>abs(m[0]));
  const s={}; if(lk[0]) s.linkedin=lk[0]; if(ig[0]) s.instagram=ig[0]; if(fb[0]) s.facebook=fb[0]; return s;
}

export default async function handler(req, res){
  try{
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const url=(req.query.url||'').trim();
    if(!url) return res.status(400).json({ ok:false, error:'missing url' });

    const seen=new Set(); const results=[]; let socials={};
    const controller=new AbortController(); const TIMEOUT=8000; const t=setTimeout(()=>controller.abort(),TIMEOUT);

    for(const slug of PAGES){
      try{
        let u=url; const base=new URL(url); if(slug) u=new URL(slug, base.origin + '/').toString();
        if(seen.has(u)) continue; seen.add(u);
        const r=await fetch(u,{ signal:controller.signal, headers:{'user-agent':'Mozilla/5.0 (AKILOV/1.0)'} });
        if(!r.ok) continue; const html=await r.text();
        extractEmails(html).forEach(e=>results.push(e));
        if(!socials.linkedin||!socials.instagram||!socials.facebook){ socials={...socials, ...extractSocials(html,u)}; }
        if(results.length>20) break;
      }catch(_){}
    }
    clearTimeout(t);
    const unique=uniq(results);
    const ranked=unique.map(email=>({ email, score:scoreEmail(email) })).sort((a,b)=>b.score-a.score);
    return res.json({ ok:true, best_email: ranked[0]?.email||null, emails_ranked: ranked, socials });
  }catch(e){
    console.error('ENRICH API ERROR:', e);
    return res.status(500).json({ ok:false, error:e.message||String(e) });
  }
}
