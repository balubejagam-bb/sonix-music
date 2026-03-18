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

      // Fallback: resolve from title/artist so playback still works for stale/broken feed URLs.
      const fallback = await resolvePodcastFallbackStream(request, title, artist);
      if (fallback) {
        return NextResponse.json({ streamUrl: fallback, source: 'podcast-fallback' });
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
      const yt = await getYouTubeStream(title, artist);
      if (yt?.streamUrl || yt?.videoId) {
        return NextResponse.json({
          streamUrl: yt.streamUrl || null,
          source: yt.streamUrl ? 'youtube' : 'youtube-video-fallback',
          videoId: yt.videoId || null,
        });
      }
    }

    return NextResponse.json({ error: 'Could not resolve stream' }, { status: 404 });
  } catch (e) {
    console.error('Stream resolve error:', e);
    return NextResponse.json({ error: 'Stream resolve failed' }, { status: 500 });
  }
}

async function resolvePodcastFallbackStream(request, title = '', artist = '') {
  try {
    const q = `${title || ''} ${artist || ''} podcast episode`.trim();
    if (!q) return null;

    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const res = await fetch(
      `${origin}/api/youtube-search?q=${encodeURIComponent(q)}&stream=true`,
      { signal: AbortSignal.timeout(8000), headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.streamUrl === 'string' && /^https?:\/\//i.test(data.streamUrl)) {
      return data.streamUrl;
    }
    return null;
  } catch {
    return null;
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
  const cleanedArtist = normalizeArtist(artist);
  const query = cleanedArtist ? `${title} ${cleanedArtist}` : title;
  try {
    const res = await fetch(
      `https://saavnapi-nine.vercel.app/result/?query=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(6000), headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data) ? data : [data];
    const titleNorm = normalizeText(title);
    const artistNorm = normalizeText(cleanedArtist || artist);
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

function normalizeArtist(artist = '') {
  const normalized = normalizeText(artist);
  if (!normalized) return '';
  // Split merged names like "A.R.RahmanSPB" into tokenized form for better search.
  const spaced = String(artist)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[\-|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced || normalized;
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
    const cleanedArtist = normalizeArtist(artist);
    const query = `${title} ${cleanedArtist || artist}${suffix}`.trim();
    let lastCandidateVideoId = null;

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
          const bestVideo = selectBestVideoCandidate(results, title, artist);
          if (bestVideo?.videoId) {
            lastCandidateVideoId = bestVideo.videoId;
            const streamUrl = await resolveYouTubeAudioStream(bestVideo.videoId);
            if (streamUrl) {
              return { videoId: bestVideo.videoId, streamUrl };
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
          const bestItem = selectBestPipedCandidate(items, title, artist);
          const videoId = bestItem?.url?.split('v=')[1]?.split('&')[0];
          if (videoId) {
            lastCandidateVideoId = videoId;
            const streamUrl = await resolveYouTubeAudioStream(videoId);
            if (streamUrl) {
              return { videoId, streamUrl };
            }
          }
        }
      } catch {}
    }

    if (lastCandidateVideoId) {
      return { videoId: lastCandidateVideoId, streamUrl: null };
    }

    return null;
  } catch (e) {
    console.error('getYouTubeStream error:', e);
    return null;
  }
}

function selectBestVideoCandidate(results, title, artist) {
  const titleNorm = normalizeText(title);
  const artistNorm = normalizeText(normalizeArtist(artist));
  const titleTokens = titleNorm.split(' ').filter((tok) => tok.length > 2);

  const scored = (results || [])
    .filter((r) => r?.videoId)
    .map((r) => {
      const t = normalizeText(r?.title || '');
      const a = normalizeText(r?.author || '');
      let score = 0;
      const titleOverlap = titleTokens.filter((tok) => t.includes(tok)).length;
      if (titleNorm && t) {
        if (t.includes(titleNorm) || titleNorm.includes(t)) score += 8;
        score += titleOverlap;
        if (titleTokens.length > 0 && titleOverlap === 0) score -= 20;
      }
      if (artistNorm && a) {
        if (a.includes(artistNorm) || artistNorm.includes(a)) score += 4;
        score += artistNorm.split(' ').filter((tok) => tok.length > 2 && a.includes(tok)).length;
      }
      return { r, score };
    })
    .sort((x, y) => y.score - x.score);

  return scored[0]?.r || results?.[0] || null;
}

function selectBestPipedCandidate(items, title, artist) {
  const titleNorm = normalizeText(title);
  const artistNorm = normalizeText(normalizeArtist(artist));
  const titleTokens = titleNorm.split(' ').filter((tok) => tok.length > 2);

  const scored = (items || [])
    .filter((i) => i?.url?.includes('v='))
    .map((i) => {
      const t = normalizeText(i?.title || '');
      const a = normalizeText(i?.uploaderName || i?.uploader || '');
      let score = 0;
      const titleOverlap = titleTokens.filter((tok) => t.includes(tok)).length;
      if (titleNorm && t) {
        if (t.includes(titleNorm) || titleNorm.includes(t)) score += 8;
        score += titleOverlap;
        if (titleTokens.length > 0 && titleOverlap === 0) score -= 20;
      }
      if (artistNorm && a) {
        if (a.includes(artistNorm) || artistNorm.includes(a)) score += 4;
        score += artistNorm.split(' ').filter((tok) => tok.length > 2 && a.includes(tok)).length;
      }
      return { i, score };
    })
    .sort((x, y) => y.score - x.score);

  return scored[0]?.i || items?.[0] || null;
}

async function resolveYouTubeAudioStream(videoId) {
  const INVIDIOUS_STREAM = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://invidious.privacyredirect.com',
    'https://invidious.protokolla.fi',
    'https://yt.artemislena.eu',
  ];
  const PIPED_STREAM = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://watchapi.whatever.social',
    'https://api.piped.yt',
  ];

  for (const instance of INVIDIOUS_STREAM) {
    try {
      const res = await fetch(
        `${instance}/api/v1/videos/${videoId}?fields=adaptiveFormats`,
        { signal: AbortSignal.timeout(4000), headers: { 'Accept': 'application/json' } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const audio = (data.adaptiveFormats || [])
        .filter((f) => f?.type?.includes('audio') && f?.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (audio?.url) return audio.url;
    } catch {}
  }

  for (const instance of PIPED_STREAM) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const data = await res.json();
      const best = (data.audioStreams || [])
        .filter((s) => s?.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (best?.url) return best.url;
    } catch {}
  }

  return null;
}
