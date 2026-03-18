export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

// Resolves a song URL/title to a direct playable audio stream URL
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const songUrl = searchParams.get('url') || '';
  const title = searchParams.get('title') || '';
  const artist = searchParams.get('artist') || '';
  const type = (searchParams.get('type') || '').toLowerCase();
  const source = (searchParams.get('source') || '').toLowerCase();
  const strict = searchParams.get('strict') === 'true';
  const isPodcast = strict || type === 'podcast' || source === 'podcast';

  if (!songUrl && !title) {
    return NextResponse.json({ error: 'url or title required' }, { status: 400 });
  }

  try {
    // If it's already a direct audio URL, return it immediately.
    if (/\.(mp3|m4a|m4b|aac|ogg|flac|wav|mp4)(\?|$)/i.test(songUrl)) {
      return NextResponse.json({ streamUrl: songUrl, source: 'direct' });
    }

    // Podcast mode is strict: prefer the dataset URL and never drift to unrelated matches.
    if (songUrl && isPodcast) {
      const podcastStream = await resolvePodcastSource(songUrl);
      if (podcastStream) {
        return NextResponse.json({ streamUrl: podcastStream, source: 'podcast' });
      }
      return NextResponse.json({ error: 'Could not resolve podcast stream from dataset URL' }, { status: 404 });
    }

    // For JioSaavn page URLs or any song with a title, use saavnapi
    const query = title || extractTitleFromUrl(songUrl);
    if (query) {
      const streamUrl = await resolveViaSaavnApi(query, artist);
      if (streamUrl) return NextResponse.json({ streamUrl, source: 'jiosaavn' });
    }

    // Fallback: YouTube via Invidious/Piped (songs only)
    if (title) {
      const ytStream = await getYouTubeStream(title, artist);
      if (ytStream) return NextResponse.json({ streamUrl: ytStream, source: 'youtube' });
    }

    return NextResponse.json({ error: 'Could not resolve stream' }, { status: 404 });
  } catch (e) {
    console.error('Stream resolve error:', e);
    return NextResponse.json({ error: 'Stream resolve failed' }, { status: 500 });
  }
}

async function resolvePodcastSource(feedOrEpisodeUrl) {
  try {
    console.log('[Podcast Resolver] Input URL:', feedOrEpisodeUrl?.substring(0, 100));
    
    // Already a direct audio URL
    if (/\.(mp3|m4a|m4b|aac|ogg|wav|flac|mp4)(\?|$)/i.test(feedOrEpisodeUrl)) {
      console.log('[Podcast Resolver] Direct audio URL detected');
      return feedOrEpisodeUrl;
    }

    // Fetch RSS feed with redirect support
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch(feedOrEpisodeUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cache-Control': 'no-cache'
      }
    });
    
    clearTimeout(timeout);
    
    if (!res.ok) {
      console.error('[Podcast Resolver] Feed HTTP error:', res.status);
      return null;
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('audio/')) {
      console.log('[Podcast Resolver] Feed URL is direct audio');
      return feedOrEpisodeUrl;
    }

    const xml = await res.text();
    if (!xml || xml.length < 50) {
      console.error('[Podcast Resolver] Invalid feed response');
      return null;
    }

    console.log('[Podcast Resolver] Feed fetched, size:', xml.length, 'bytes');

    // Extract FIRST audio enclosure from RSS/Atom feed
    const patterns = [
      // RSS enclosure with explicit audio type
      /<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']audio/i,
      // Any enclosure (may contain audio URL)
      /<enclosure[^>]*url=["']([^"']+)["']/i,
      // Media content with audio
      /<media:content[^>]*url=["']([^"']+)["'][^>]*type=["']audio/i,
      // Link with enclosure rel
      /<link[^>]*rel=["']enclosure["'][^>]*href=["']([^"']+)["']/i,
      // iTunes:url tag
      /<itunes:url[^>]*>([^<]+)<\/itunes:url>/i,
    ];

    for (let i = 0; i < patterns.length; i++) {
      const rx = patterns[i];
      const m = xml.match(rx);
      if (!m?.[1]) {
        console.log('[Podcast Resolver] Pattern', i, 'no match');
        continue;
      }
      
      const url = m[1].trim();
      if (!url || url.length < 10) continue;
      
      try {
        // Try to resolve relative URLs
        const resolved = new URL(url, feedOrEpisodeUrl).toString();
        console.log('[Podcast Resolver] Resolved audio URL from pattern', i);
        return resolved;
      } catch (e) {
        // URL might be absolute already
        if (/^https?:\/\//i.test(url)) {
          console.log('[Podcast Resolver] Using absolute URL from pattern', i);
          return url;
        }
        console.error('[Podcast Resolver] Pattern', i, 'URL parse error:', e.message);
      }
    }
    
    console.warn('[Podcast Resolver] No audio enclosure found in RSS feed');
    return null;
    
  } catch (e) {
    console.error('[Podcast Resolver] Exception:', e.message);
    return null;
  }
}

function extractTitleFromUrl(url) {
  try {
    // e.g. https://www.jiosaavn.com/song/mastaaru-mastaaru/JgQxaCZTUWI
    const parts = url.split('/').filter(Boolean);
    const songIdx = parts.indexOf('song');
    if (songIdx >= 0 && parts[songIdx + 1]) {
      return parts[songIdx + 1].replace(/-/g, ' ');
    }
    return '';
  } catch {
    return '';
  }
}

async function resolveViaSaavnApi(title, artist = '') {
  const query = artist ? `${title} ${artist}` : title;
  try {
    const res = await fetch(
      `https://saavnapi-nine.vercel.app/result/?query=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(6000), headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data) ? data : [data];
    const titleNorm = normalizeText(title);
    const artistNorm = normalizeText(artist);
    const ranked = list
      .filter(Boolean)
      .map((song) => ({ song, score: scoreSaavnCandidate(song, titleNorm, artistNorm) }))
      .sort((a, b) => b.score - a.score);

    const song = ranked[0]?.song || list[0];
    const url = song?.media_url || song?.['320kbps_url'] || song?.['160kbps_url'] || song?.['96kbps_url'];
    if (url && url.startsWith('http')) return url;
    return null;
  } catch (e) {
    console.error('saavnapi resolve error:', e);
    return null;
  }
}

function normalizeText(v = '') {
  return String(v || '')
    .toLowerCase()
    .replace(/&quot;|&#39;|&amp;/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreSaavnCandidate(song, titleNorm, artistNorm) {
  const songTitle = normalizeText(song?.title || song?.name || song?.song || '');
  const songArtist = normalizeText(song?.artist || song?.artists || song?.primary_artists || '');

  let score = 0;
  if (titleNorm && songTitle) {
    if (songTitle === titleNorm) score += 10;
    if (songTitle.includes(titleNorm) || titleNorm.includes(songTitle)) score += 6;
    const titleTokens = titleNorm.split(' ').filter((t) => t.length > 2);
    score += titleTokens.filter((t) => songTitle.includes(t)).length;
  }

  if (artistNorm && songArtist) {
    if (songArtist.includes(artistNorm) || artistNorm.includes(songArtist)) score += 4;
    const artistTokens = artistNorm.split(' ').filter((t) => t.length > 2);
    score += artistTokens.filter((t) => songArtist.includes(t)).length;
  }

  return score;
}

async function getYouTubeStream(title, artist) {
  const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://invidious.privacyredirect.com',
    'https://invidious.protokolla.fi',
    'https://yt.artemislena.eu',
    'https://invidious.perennialte.ch',
  ];
  const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://watchapi.whatever.social',
    'https://pipedapi.in.projectsegfau.lt',
    'https://api.piped.yt',
  ];

  try {
    const isPodcast = title.toLowerCase().includes('podcast') || artist.toLowerCase().includes('podcast');
    const suffix = isPodcast ? '' : ' official audio';
    const query = `${title} ${artist}${suffix}`.trim();

    // Try Invidious instances first
    for (const instance of INVIDIOUS_INSTANCES.slice(0, 3)) {
      try {
        const res = await fetch(
          `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (!res.ok) continue;
        const results = await res.json();
        if (Array.isArray(results) && results.length > 0) {
          for (const video of results) {
            if (video.videoId && video.videoThumbnails?.length > 0) {
              return `https://www.youtube.com/watch?v=${video.videoId}`;
            }
          }
        }
      } catch {}
    }

    // Fallback: Try Piped
    for (const instance of PIPED_INSTANCES.slice(0, 2)) {
      try {
        const res = await fetch(
          `${instance}/search?q=${encodeURIComponent(query)}`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (!res.ok) continue;
        const data = await res.json();
        const items = (data.items || []).filter((i) => i?.url?.includes('/watch'));
        if (items.length > 0) {
          const videoId = items[0].url.split('v=')[1]?.split('&')[0];
          if (videoId) {
            return `https://www.youtube.com/watch?v=${videoId}`;
          }
        }
      } catch {}
    }

    return null;
  } catch (e) {
    console.error('getYouTubeStream error:', e);
    return null;
  }
}
