/**
 * YouTube Data API v3 service with daily quota tracking.
 * Each search costs 100 units. Daily limit default: 9000 units (90 searches).
 * Falls back to Piped/Invidious when quota is exhausted.
 */

const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const DAILY_QUOTA = parseInt(process.env.YT_DAILY_QUOTA || '9000');
const COST_PER_SEARCH = 100;

// In-memory quota tracker (resets at midnight UTC)
const quota = globalThis.__sonix_yt_quota || { used: 0, date: todayUTC() };
if (!globalThis.__sonix_yt_quota) globalThis.__sonix_yt_quota = quota;

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function checkAndConsumeQuota() {
  const today = todayUTC();
  if (quota.date !== today) {
    quota.used = 0;
    quota.date = today;
  }
  if (quota.used + COST_PER_SEARCH > DAILY_QUOTA) return false;
  quota.used += COST_PER_SEARCH;
  return true;
}

export function getQuotaStatus() {
  return { used: quota.used, limit: DAILY_QUOTA, remaining: DAILY_QUOTA - quota.used, date: quota.date };
}

/**
 * Search YouTube Data API v3.
 * Returns array of { videoId, title, thumbnail, channelTitle }
 */
export async function searchYouTubeAPI(query, maxResults = 5) {
  if (!YT_API_KEY) return null;
  if (!checkAndConsumeQuota()) {
    console.warn('[YT API] Daily quota exhausted, skipping API call');
    return null;
  }

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      q: `${query} official audio`,
      type: 'video',
      maxResults: String(maxResults),
      videoCategoryId: '10', // Music category
      key: YT_API_KEY,
    });

    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[YT API] Error:', err?.error?.message || res.status);
      return null;
    }

    const data = await res.json();
    return (data.items || []).map(item => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title || '',
      thumbnail: item.snippet?.thumbnails?.medium?.url || `https://img.youtube.com/vi/${item.id?.videoId}/mqdefault.jpg`,
      channelTitle: item.snippet?.channelTitle || '',
    })).filter(v => v.videoId);
  } catch (err) {
    console.error('[YT API] Fetch failed:', err.message);
    return null;
  }
}
