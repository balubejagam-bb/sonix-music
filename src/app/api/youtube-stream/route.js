import { NextResponse } from 'next/server';

// This endpoint extracts the direct audio stream URL from a YouTube video
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');
    
    if (!videoId) {
      return NextResponse.json({ error: 'videoId required' }, { status: 400 });
    }

    // Try multiple methods to get the stream URL
    const streamUrl = await getYouTubeStreamUrl(videoId);
    
    if (!streamUrl) {
      return NextResponse.json({ error: 'Could not extract stream URL' }, { status: 404 });
    }

    return NextResponse.json({ 
      videoId,
      streamUrl,
      success: true 
    });
  } catch (error) {
    console.error('YouTube stream error:', error);
    return NextResponse.json({ error: 'Failed to get stream' }, { status: 500 });
  }
}

async function getYouTubeStreamUrl(videoId) {
  // Method 1: Try Invidious instances
  const invidiousInstances = [
    'https://inv.nadeko.net',
    'https://invidious.privacyredirect.com',
    'https://invidious.nerdvpn.de'
  ];

  for (const instance of invidiousInstances) {
    try {
      const url = `${instance}/api/v1/videos/${videoId}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(4000),
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) continue;
      const data = await res.json();
      
      // Get the best audio format
      const audioFormats = data.adaptiveFormats?.filter(f => 
        f.type?.includes('audio') && f.url
      ) || [];
      
      if (audioFormats.length > 0) {
        // Sort by bitrate and get the best quality
        audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        return audioFormats[0].url;
      }
    } catch (e) {
      continue;
    }
  }

  // Method 2: Try Piped instances
  const pipedInstances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.tokhmi.xyz'
  ];

  for (const instance of pipedInstances) {
    try {
      const url = `${instance}/streams/${videoId}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(4000)
      });

      if (!res.ok) continue;
      const data = await res.json();
      
      if (data.audioStreams && data.audioStreams.length > 0) {
        // Get the best quality audio stream
        const bestAudio = data.audioStreams.sort((a, b) => 
          (b.bitrate || 0) - (a.bitrate || 0)
        )[0];
        return bestAudio.url;
      }
    } catch (e) {
      continue;
    }
  }

  return null;
}
