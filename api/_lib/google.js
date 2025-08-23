const GP_KEY = process.env.GOOGLE_MAPS_API_KEY;

function corsFix(url) { return url; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function textSearch(query, region) {
  if (!GP_KEY) throw new Error('GOOGLE_MAPS_API_KEY is missing');
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', query);
  url.searchParams.set('key', GP_KEY);
  // Optional: region bias - use country code when region is IL or US
  if (region === 'IL') url.searchParams.set('region', 'il');
  if (region === 'US') url.searchParams.set('region', 'us');
  const res = await fetch(corsFix(url.toString()));
  if (!res.ok) throw new Error('Google Text Search failed: ' + res.status);
  const json = await res.json();
  if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
    throw new Error('Google status: ' + json.status + ' - ' + (json.error_message || ''));
  }
  return json.results || [];
}

export async function placeDetails(placeId) {
  if (!GP_KEY) throw new Error('GOOGLE_MAPS_API_KEY is missing');
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', [
    'place_id','name','formatted_address','address_components','geometry/location','rating','user_ratings_total','url','website','international_phone_number'
  ].join(','));
  url.searchParams.set('key', GP_KEY);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Google Details failed: ' + res.status);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error('Google details status: ' + json.status);
  return json.result;
}

export function parseAddress(comp) {
  const out = { city: '', state: '', country: '' };
  const map = {};
  if (!comp) return out;
  for (const c of comp) {
    for (const t of c.types) map[t] = c.long_name;
  }
  out.city = map.locality || map.postal_town || map.administrative_area_level_2 || '';
  out.state = map.administrative_area_level_1 || '';
  out.country = map.country || '';
  return out;
}

export function toPlaceRow(d) {
  const addr = parseAddress(d.address_components || []);
  return {
    place_id: d.place_id,
    name: d.name,
    address: d.formatted_address || '',
    city: addr.city,
    state: addr.state,
    country: addr.country,
    lat: d.geometry?.location?.lat || null,
    lng: d.geometry?.location?.lng || null,
    rating: d.rating || null,
    user_ratings_total: d.user_ratings_total || 0,
    website: d.website || '',
    phone: d.international_phone_number || ''
  };
}
