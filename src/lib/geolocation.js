// Lightweight IP geolocation lookup. Free/keyless providers are rate-limited
// and not meant for high volume - see README for production alternatives
// (a local MaxMind GeoLite2 database avoids outbound calls entirely and is
// the recommended path once you have real traffic).

const cache = new Map(); // ip -> { data, expires }
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12h, IP-to-region rarely changes

async function geolocate(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || process.env.GEO_PROVIDER === '') {
    return { country: null, region: null, city: null };
  }

  const cached = cache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.data;

  try {
    // ipapi.co keyless endpoint. Swap this block for your provider of choice.
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`geo lookup failed: ${res.status}`);
    const json = await res.json();
    const data = {
      country: json.country_name || null,
      region: json.region || null,
      city: json.city || null,
    };
    cache.set(ip, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    // Never let a geolocation hiccup block a redirect.
    return { country: null, region: null, city: null };
  }
}

module.exports = { geolocate };
