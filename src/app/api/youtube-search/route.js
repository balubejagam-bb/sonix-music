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

async function searchWithInvidious(query, multi = false) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`;
      const res = await fetch(url, { 
        signal: AbortSignal.timeout(8000),
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const videos = data.filter(i => i.type === 'video' && i.videoId);
        if (videos.length > 0) {
          if (multi) return videos.map(v => ({ videoId: v.videoId, title: v.title, artist: v.author, thumbnail: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg` }));
          return { videoId: videos[0].videoId, title: videos[0].title || '' };
        }
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

async function searchWithPiped(query, multi = false) {
  for (const instance of PIPED_INSTANCES) {
    for (const filter of ['music_songs', 'videos']) {
      try {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=${filter}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;
        const data = await res.json();
        const items = (data.items || data).filter(i => i.url?.includes('/watch'));
        if (items.length > 0) {
          if (multi) return items.map(i => {
            const videoId = i.url.split('v=')[1]?.split('&')[0];
            return { videoId, title: i.title, artist: i.uploaderName || i.uploader, thumbnail: i.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` };
          }).filter(v => v.videoId);
          const first = items[0];
          const videoId = first.url.split('v=')[1]?.split('&')[0];
          return { videoId, title: first.title || '' };
        }
      } catch (e) {
        continue;
      }
    }
  }
  return null;
}

async function searchWithYTScrape(query) {
  try {
    // Use YouTube's internal suggest/complete API
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Extract video IDs from the HTML
    const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (videoIdMatch) {
      return { videoId: videoIdMatch[1], title: '' };
    }
  } catch (e) {
    console.error('YT scrape error:', e.message);
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const multi = searchParams.get('multi') === 'true';

  if (!q) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  // Try all methods in parallel for speed
  const [invidiousResult, pipedResult, scrapeResult] = await Promise.allSettled([
    searchWithInvidious(q, multi),
    searchWithPiped(q, multi),
    searchWithYTScrape(q), // Scrape doesn't support multi yet
  ]);

  if (multi) {
    // Collect all unique results from multi-sources
    const results = [];
    const seen = new Set();
    [invidiousResult, pipedResult].forEach(res => {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        res.value.forEach(v => {
          if (!seen.has(v.videoId)) {
            seen.add(v.videoId);
            results.push(v);
          }
        });
      }
    });
    return NextResponse.json({ results: results.slice(0, 15) });
  }

  // Return the first successful result
  for (const result of [invidiousResult, pipedResult, scrapeResult]) {
    if (result.status === 'fulfilled' && result.value?.videoId) {
      return NextResponse.json(result.value);
    }
  }

  // Retry with simpler query
  const simpleQ = q.replace(/official audio|official|audio|full song/gi, '').trim();
  if (simpleQ !== q) {
    const retryResult = await searchWithYTScrape(simpleQ);
    if (retryResult?.videoId) {
      return NextResponse.json(retryResult);
    }
  }

  return NextResponse.json({ videoId: null, error: 'No results found' });
}
