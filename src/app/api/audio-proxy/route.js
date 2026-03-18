export const dynamic = 'force-dynamic';

const AUDIO_EXT_RE = /\.(mp3|m4a|m4b|aac|ogg|flac|wav|mp4)(\?|$)/i;

function inferContentType(url = '') {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.mp3')) return 'audio/mpeg';
  if (lower.includes('.m4a') || lower.includes('.m4b') || lower.includes('.mp4')) return 'audio/mp4';
  if (lower.includes('.aac')) return 'audio/aac';
  if (lower.includes('.ogg')) return 'audio/ogg';
  if (lower.includes('.flac')) return 'audio/flac';
  if (lower.includes('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url') || '';

  if (!/^https?:\/\//i.test(target)) {
    return new Response('Invalid audio url', { status: 400 });
  }

  try {
    const requestHeaders = {
      'Accept': request.headers.get('accept') || 'audio/*,*/*;q=0.8',
      'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
    };

    const range = request.headers.get('range');
    if (range) {
      requestHeaders.Range = range;
    }

    const upstream = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: requestHeaders,
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(`Upstream audio fetch failed (${upstream.status})`, { status: upstream.status });
    }

    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=300');
    headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    headers.set('Content-Type', upstream.headers.get('content-type') || inferContentType(target));

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);

    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers.set('Content-Range', contentRange);

    const etag = upstream.headers.get('etag');
    if (etag) headers.set('ETag', etag);

    const lastModified = upstream.headers.get('last-modified');
    if (lastModified) headers.set('Last-Modified', lastModified);

    const dispositionName = (() => {
      try {
        const pathname = new URL(upstream.url || target).pathname;
        const file = pathname.split('/').filter(Boolean).pop() || 'audio';
        return AUDIO_EXT_RE.test(file) ? file : `${file}.mp3`;
      } catch {
        return 'audio.mp3';
      }
    })();
    headers.set('Content-Disposition', `inline; filename="${dispositionName}"`);

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return new Response(`Audio proxy failed: ${error?.message || 'unknown error'}`, { status: 502 });
  }
}
