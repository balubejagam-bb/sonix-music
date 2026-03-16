/**
 * Shared Piped + Invidious search helpers.
 * Used by both /api/search and /api/youtube-search directly — no HTTP self-calls.
 */

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://watchapi.whatever.social',
  'https://pipedapi.in.projectsegfau.lt',
  'https://api.piped.yt',
  'https://pipedapi.r4fo.com',
];

const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacyredirect.com',
  'https://invidious.protokolla.fi',
  'https://yt.artemislena.eu',
  'https://invidious.perennialte.ch',
];

function mapVideo(videoId, title, artist, thumbnail) {
  return {
    videoId,
    title: title || '',
    artist: artist || '',
    thumbnail: thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
  };
}

export async function searchWithInvidiousDirect(query, multi = false) {
  const calls = INVIDIOUS.slice(0, 4).map(async (instance) => {
    try {
      const res = await fetch(
        `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
        { signal: AbortSignal.timeout(3500), headers: { Accept: 'application/json' } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) return null;
      const videos = data.filter(v => v.type === 'video' && v.videoId);
      if (!videos.length) return null;
      if (multi) return videos.slice(0, 10).map(v => mapVideo(v.videoId, v.title, v.author, v.videoThumbnails?.[0]?.url));
      const f = videos[0];
      return mapVideo(f.videoId, f.title, f.author, f.videoThumbnails?.[0]?.url);
    } catch { return null; }
  });

  const settled = await Promise.allSettled(calls);
  if (multi) {
    const out = [], seen = new Set();
    for (const r of settled) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
      for (const v of r.value) {
        if (!v?.videoId || seen.has(v.videoId)) continue;
        seen.add(v.videoId); out.push(v);
      }
    }
    return out.length ? out : null;
  }
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value?.videoId) return r.value;
  }
  return null;
}

export async function searchWithPipedDirect(query, multi = false) {
  const calls = [];
  for (const instance of PIPED.slice(0, 3)) {
    for (const filter of ['music_songs', 'videos']) {
      calls.push((async () => {
        try {
          const res = await fetch(
            `${instance}/search?q=${encodeURIComponent(query)}&filter=${filter}`,
            { signal: AbortSignal.timeout(2500) }
          );
          if (!res.ok) return null;
          const data = await res.json();
          const items = (data.items || data || []).filter(i => i?.url?.includes('/watch'));
          if (!items.length) return null;
          if (multi) {
            return items.slice(0, 10).map(i => {
              const videoId = i.url.split('v=')[1]?.split('&')[0];
              return videoId ? mapVideo(videoId, i.title, i.uploaderName || i.uploader, i.thumbnail) : null;
            }).filter(Boolean);
          }
          const first = items[0];
          const videoId = first.url.split('v=')[1]?.split('&')[0];
          return videoId ? mapVideo(videoId, first.title, first.uploaderName || first.uploader, first.thumbnail) : null;
        } catch { return null; }
      })());
    }
  }

  const settled = await Promise.allSettled(calls);
  if (multi) {
    const out = [], seen = new Set();
    for (const r of settled) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
      for (const v of r.value) {
        if (!v?.videoId || seen.has(v.videoId)) continue;
        seen.add(v.videoId); out.push(v);
      }
    }
    return out.length ? out : null;
  }
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value?.videoId) return r.value;
  }
  return null;
}

export async function scrapeYouTube(query) {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`,
      {
        signal: AbortSignal.timeout(4000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    if (!res.ok) return null;
    const html = await res.text();
    // Extract multiple video IDs
    const matches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)];
    const seen = new Set();
    const results = [];
    for (const m of matches) {
      if (!seen.has(m[1])) { seen.add(m[1]); results.push(mapVideo(m[1], '', '', '')); }
      if (results.length >= 5) break;
    }
    return results.length ? results : null;
  } catch { return null; }
}
