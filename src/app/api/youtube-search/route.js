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
];

function mapVideo(videoId, title, artist, thumbnail) {
  return {
    videoId,
    title: title || '',
    artist: artist || '',
    thumbnail: thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
  };
}

async function searchWithInvidious(query, multi = false) {
  const calls = INVIDIOUS_INSTANCES.slice(0, 4).map(async (instance) => {
    try {
      const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(3000),
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
    } catch {
      return null;
    }
  });

  const settled = await Promise.allSettled(calls);

  if (multi) {
    const merged = [];
    const seen = new Set();
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
    if (result.status === 'fulfilled' && result.value?.videoId) {
      return result.value;
    }
  }

  return null;
}

async function searchWithPiped(query, multi = false) {
  const filters = ['music_songs', 'videos'];
  const calls = [];

  for (const instance of PIPED_INSTANCES.slice(0, 4)) {
    for (const filter of filters) {
      calls.push((async () => {
        try {
          const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=${filter}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
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
        } catch {
          return null;
        }
      })());
    }
  }

  const settled = await Promise.allSettled(calls);

  if (multi) {
    const merged = [];
    const seen = new Set();
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
    if (result.status === 'fulfilled' && result.value?.videoId) {
      return result.value;
    }
  }

  return null;
}

async function searchWithYTScrape(query) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3500),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!res.ok) return null;

    const html = await res.text();
    const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (!videoIdMatch) return null;

    return mapVideo(videoIdMatch[1], '', '', `https://img.youtube.com/vi/${videoIdMatch[1]}/mqdefault.jpg`);
  } catch {
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const multi = searchParams.get('multi') === 'true';

  if (!q) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  // Try all methods in parallel for speed
  try {
    const [invidiousResult, pipedResult, scrapeResult] = await Promise.allSettled([
      searchWithInvidious(q, multi),
      searchWithPiped(q, multi),
      searchWithYTScrape(q), 
    ]);

    if (multi) {
      const results = [];
      const seen = new Set();
      [invidiousResult, pipedResult].forEach((res) => {
        if (res.status !== 'fulfilled' || !Array.isArray(res.value)) return;
        res.value.forEach((v) => {
          if (!v?.videoId || seen.has(v.videoId)) return;
          seen.add(v.videoId);
          results.push(v);
        });
      });
      return NextResponse.json({ results: results.slice(0, 15) });
    }

    // Return the first valid videoId
    for (const result of [invidiousResult, pipedResult, scrapeResult]) {
      if (result.status === 'fulfilled' && result.value?.videoId) {
        return NextResponse.json(result.value);
      }
    }

    // Last resort scrape retry
    const simpleQ = q.replace(/official audio|official|audio|full song/gi, '').trim();
    if (simpleQ !== q) {
      const retryResult = await searchWithYTScrape(simpleQ);
      if (retryResult?.videoId) {
        return NextResponse.json(retryResult);
      }
    }

    if (multi) {
      return NextResponse.json({ results: [] });
    }
    return NextResponse.json({ videoId: null, error: 'No results found' });
  } catch (err) {
    console.error('Final search crash:', err);
    return NextResponse.json({ error: 'Search Engine Error', details: err.message }, { status: 500 });
  }
}
