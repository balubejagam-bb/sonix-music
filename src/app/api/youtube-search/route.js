import { NextResponse } from 'next/server';

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://watchapi.whatever.social',
  'https://pipedapi.in.projectsegfau.lt',
  'https://api.piped.yt',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.leptons.xyz',
];

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacyredirect.com',
  'https://invidious.protokolla.fi',
  'https://yt.artemislena.eu',
  'https://invidious.perennialte.ch',
  'https://iv.datura.network',
  'https://invidious.fdn.fr',
];

// Server-side cache: query → { results, ts }
const ytCache = globalThis.__sonix_yt_cache || new Map();
if (!globalThis.__sonix_yt_cache) globalThis.__sonix_yt_cache = ytCache;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(q) {
  const entry = ytCache.get(q);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { ytCache.delete(q); return null; }
  return entry.results;
}
function setCached(q, results) {
  ytCache.set(q, { results, ts: Date.now() });
  // Keep cache size bounded
  if (ytCache.size > 200) {
    const oldest = [...ytCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    ytCache.delete(oldest[0]);
  }
}

function mapVideo(videoId, title, artist, thumbnail) {
  return {
    videoId,
    title: title || '',
    artist: artist || '',
    thumbnail: thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
  };
}

async function searchWithInvidious(query, multi = false) {
  const calls = INVIDIOUS_INSTANCES.slice(0, 5).map(async (instance) => {
    try {
      const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(4000),
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) return null;
      const videos = data.filter((item) => item.type === 'video' && item.videoId);
      if (!videos.length) return null;
      if (multi) {
        return videos.slice(0, 10).map((v) => mapVideo(v.videoId, v.title, v.author, v.videoThumbnails?.[0]?.url));
      }
      const first = videos[0];
      return mapVideo(first.videoId, first.title, first.author, first.videoThumbnails?.[0]?.url);
    } catch { return null; }
  });

  const settled = await Promise.allSettled(calls);
  if (multi) {
    const merged = [], seen = new Set();
    for (const result of settled) {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
      for (const item of result.value) {
        if (!item?.videoId || seen.has(item.videoId)) continue;
        seen.add(item.videoId);
        merged.push(item);
      }
    }
    return merged.length ? merged : null;
  }
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value?.videoId) return result.value;
  }
  return null;
}

async function searchWithPiped(query, multi = false) {
  const filters = ['music_songs', 'videos'];
  const calls = [];
  for (const instance of PIPED_INSTANCES.slice(0, 5)) {
    for (const filter of filters) {
      calls.push((async () => {
        try {
          const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=${filter}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) return null;
          const data = await res.json();
          const items = (data.items || data || []).filter((i) => i?.url?.includes('/watch'));
          if (!items.length) return null;
          if (multi) {
            return items.slice(0, 10).map((i) => {
              const videoId = i.url.split('v=')[1]?.split('&')[0];
              return videoId ? mapVideo(videoId, i.title, i.uploaderName || i.uploader, i.thumbnail) : null;
            }).filter(Boolean);
          }
          const first = items[0];
          const videoId = first.url.split('v=')[1]?.split('&')[0];
          if (!videoId) return null;
          return mapVideo(videoId, first.title, first.uploaderName || first.uploader, first.thumbnail);
        } catch { return null; }
      })());
    }
  }
  const settled = await Promise.allSettled(calls);
  if (multi) {
    const merged = [], seen = new Set();
    for (const result of settled) {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
      for (const item of result.value) {
        if (!item?.videoId || seen.has(item.videoId)) continue;
        seen.add(item.videoId);
        merged.push(item);
      }
    }
    return merged.length ? merged : null;
  }
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value?.videoId) return result.value;
  }
  return null;
}

async function searchWithYTScrape(query, multi = false) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    if (multi) {
      // Extract videoId + title pairs from ytInitialData
      const matches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})","thumbnail".*?"title":\{"runs":\[\{"text":"([^"]+)"/g)];
      if (!matches.length) {
        // Fallback: just extract IDs
        const idMatches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)];
        const seen = new Set(), results = [];
        for (const m of idMatches) {
          if (!seen.has(m[1])) { seen.add(m[1]); results.push(mapVideo(m[1], '', '', '')); }
          if (results.length >= 10) break;
        }
        return results.length ? results : null;
      }
      const seen = new Set(), results = [];
      for (const m of matches) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          results.push(mapVideo(m[1], m[2] || '', '', ''));
        }
        if (results.length >= 10) break;
      }
      return results.length ? results : null;
    }

    const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (!videoIdMatch) return null;
    return mapVideo(videoIdMatch[1], '', '', `https://img.youtube.com/vi/${videoIdMatch[1]}/mqdefault.jpg`);
  } catch { return null; }
}

async function getStreamUrl(videoId) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${videoId}?fields=adaptiveFormats`, {
        signal: AbortSignal.timeout(4000),
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const audioFormats = (data.adaptiveFormats || [])
        .filter(f => f.type?.includes('audio') && f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (audioFormats.length > 0) return audioFormats[0].url;
    } catch { continue; }
  }
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.audioStreams?.length > 0) {
        const best = data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        return best.url;
      }
    } catch { continue; }
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const multi = searchParams.get('multi') === 'true';
  const withStream = searchParams.get('stream') === 'true';

  if (!q) return NextResponse.json({ error: 'Missing query' }, { status: 400 });

  // Serve from cache if available
  if (multi) {
    const cached = getCached(q);
    if (cached) return NextResponse.json({ results: cached });
  }

  try {
    // Run all three sources in parallel
    const [invidiousResult, pipedResult, scrapeResult] = await Promise.allSettled([
      searchWithInvidious(q, multi),
      searchWithPiped(q, multi),
      multi ? searchWithYTScrape(q, true) : Promise.resolve(null),
    ]);

    if (multi) {
      const results = [], seen = new Set();
      for (const res of [invidiousResult, pipedResult, scrapeResult]) {
        if (res.status !== 'fulfilled' || !Array.isArray(res.value)) continue;
        for (const v of res.value) {
          if (!v?.videoId || seen.has(v.videoId)) continue;
          seen.add(v.videoId);
          results.push(v);
        }
      }

      // Last resort: scrape if still empty
      if (!results.length) {
        const scraped = await searchWithYTScrape(q, true);
        if (Array.isArray(scraped)) {
          for (const v of scraped) {
            if (!v?.videoId || seen.has(v.videoId)) continue;
            seen.add(v.videoId);
            results.push(v);
          }
        }
      }

      const final = results.slice(0, 15);
      if (final.length) setCached(q, final);
      return NextResponse.json({ results: final });
    }

    // Single result
    let found = null;
    for (const result of [invidiousResult, pipedResult]) {
      if (result.status === 'fulfilled' && result.value?.videoId) { found = result.value; break; }
    }

    // Fallback to scrape
    if (!found) {
      const scraped = await searchWithYTScrape(q, false);
      if (scraped?.videoId) found = scraped;
    }

    if (!found) {
      const simpleQ = q.replace(/official audio|official|audio|full song/gi, '').trim();
      if (simpleQ !== q) {
        const retry = await searchWithYTScrape(simpleQ, false);
        if (retry?.videoId) found = retry;
      }
    }

    if (!found) return NextResponse.json({ videoId: null, error: 'No results found' });

    if (withStream && found.videoId) {
      const streamUrl = await getStreamUrl(found.videoId);
      return NextResponse.json({ ...found, streamUrl: streamUrl || null });
    }

    return NextResponse.json(found);
  } catch (err) {
    console.error('YT search crash:', err);
    return NextResponse.json({ error: 'Search Engine Error', details: err.message }, { status: 500 });
  }
}
