import { NextResponse } from 'next/server';

// Resolves a song URL/title to a direct playable audio stream URL
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const songUrl = searchParams.get('url') || '';
  const title = searchParams.get('title') || '';
  const artist = searchParams.get('artist') || '';

  if (!songUrl && !title) {
    return NextResponse.json({ error: 'url or title required' }, { status: 400 });
  }

  try {
    // If it's already a direct audio URL (.mp3/.m4a/.aac etc), return it
    if (/\.(mp3|m4a|aac|ogg|flac|wav)(\?|$)/i.test(songUrl)) {
      return NextResponse.json({ streamUrl: songUrl, source: 'direct' });
    }

    // For JioSaavn page URLs or any song with a title, use saavnapi
    const query = title || extractTitleFromUrl(songUrl);
    if (query) {
      const streamUrl = await resolveViaSaavnApi(query, artist);
      if (streamUrl) return NextResponse.json({ streamUrl, source: 'jiosaavn' });
    }

    // Fallback: YouTube via Invidious/Piped
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

// Uses saavnapi-nine.vercel.app — confirmed working, returns media_url directly
async function resolveViaSaavnApi(title, artist = '') {
  const query = artist ? `${title} ${artist}` : title;
  try {
    const res = await fetch(
      `https://saavnapi-nine.vercel.app/result/?query=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(6000), headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Returns array; first result has media_url (direct .mp4 audio stream)
    const song = Array.isArray(data) ? data[0] : data;
    const url = song?.media_url || song?.['320kbps_url'] || song?.['160kbps_url'] || song?.['96kbps_url'];
    if (url && url.startsWith('http')) return url;
    return null;
  } catch (e) {
    console.error('saavnapi resolve error:', e);
    return null;
  }
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
    let videoId = null;

    // Try multiple instances in parallel for search
    const searchTasks = INVIDIOUS_INSTANCES.slice(0, 4).map(async (instance) => {
      try {
        const res = await fetch(
          `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
          { signal: AbortSignal.timeout(3000), headers: { 'Accept': 'application/json' } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const first = (data || []).find(v => v.type === 'video' && v.videoId);
        return first ? first.videoId : null;
      } catch { return null; }
    });

    const searchResults = await Promise.allSettled(searchTasks);
    for (const r of searchResults) {
      if (r.status === 'fulfilled' && r.value) { videoId = r.value; break; }
    }

    if (!videoId) return null;

    // Try multiple instances in parallel for stream resolution
    const streamTasks = [
      ...INVIDIOUS_INSTANCES.slice(0, 3).map(async (instance) => {
        try {
          const res = await fetch(
            `${instance}/api/v1/videos/${videoId}?fields=adaptiveFormats`,
            { signal: AbortSignal.timeout(4000), headers: { 'Accept': 'application/json' } }
          );
          if (!res.ok) return null;
          const data = await res.json();
          const audioFormats = (data.adaptiveFormats || [])
            .filter(f => f.type?.includes('audio') && f.url)
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          return audioFormats.length > 0 ? audioFormats[0].url : null;
        } catch { return null; }
      }),
      ...PIPED_INSTANCES.slice(0, 3).map(async (instance) => {
        try {
          const res = await fetch(`${instance}/streams/${videoId}`, { signal: AbortSignal.timeout(4000) });
          if (!res.ok) return null;
          const data = await res.json();
          if (data.audioStreams?.length > 0) {
            return data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0].url;
          }
          return null;
        } catch { return null; }
      })
    ];

    const streamResults = await Promise.allSettled(streamTasks);
    for (const r of streamResults) {
      if (r.status === 'fulfilled' && r.value) return r.value;
    }
  } catch (e) {
    console.error('YouTube stream error:', e);
  }
  return null;
}
