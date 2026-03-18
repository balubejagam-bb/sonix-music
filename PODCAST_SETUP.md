# PODCAST PLAYBACK CONFIGURATION

## Current Status

✅ **Fixed:**
- Console errors suppressed (chrome extension errors)
- Podcast stream resolution infrastructure in place
- Podcasts properly separated from songs in UI
- YouTube fallback disabled for podcasts
- Native Android audio playback for podcasts (when streams available)

❌ **Issue:** Podcast RSS feed URLs in database are returning 404 errors
- Example problematic URL: `http://www.iblug.com/xml/itunes/agdarmstadt.xml` → 404
- The URL structure exists in DB but feeds are not accessible

---

## What You Need to Do

### 1. Update Podcast URLs in MongoDB

Your `podcasts` collection needs RSS feed URLs that **actually return valid podcast XML** with audio enclosures.

Required podcast document structure:
```json
{
  "_id": ObjectId("..."),
  "title": "Podcast Name",
  "artist": "Podcast Host",
  "type": "podcast",
  "source": "podcast",
  "url": "https://example.com/feeds/podcast.rss",  // MUST be a valid RSS feed
  "image": "https://...",
  "description": "..."
}
```

### 2. Valid Podcast URLs

Your RSS feeds MUST:
- Be accessible over HTTPS (or HTTP with proper redirects)
- Return valid RSS/Atom XML
- Contain `<enclosure>` tags with `type="audio/mpeg"` or similar
- Example working structure:
  ```xml
  <rss>
    <channel>
      <item>
        <title>Episode 1</title>
        <enclosure url="https://cdn.example.com/episode1.mp3" type="audio/mpeg" />
      </item>
    </channel>
  </rss>
  ```

### 3. How to Update

Option A: **Replace with known working feeds**
```javascript
db.podcasts.updateMany({}, {
  $set: {
    url: "https://feeds.apple.com/... // Replace with valid feed
  }
})
```

Option B: **Use test data**
- See TEST_PODCASTS.json for example valid podcast data

---

## Playback Flow (After You Fix Podcast URLs)

### When User Plays a Podcast:

1. **UI calls** `playSongDirect(podcast, podcastsList)`

2. **Backend resolves stream:**
   - Fetches podcast RSS feed from `podcast.url`
   - Extracts first audio `<enclosure>` URL
   - Returns direct audio stream URL (e.g., `.mp3`)

3. **Playback engine:**
   - Android: Plays via ExoPlayer (native audio)
   - Web: Plays via HTML5 `<audio>` element
   - **NO** YouTube fallback (unlike songs)

4. **Result:** Podcast audio plays directly, no mixing with songs

---

## Testing

### Verify Podcast Feed is Valid
```bash
curl -I "https://your-podcast-feed-url.rss"
# Should return 200 OK and XML content-type
```

### Test Stream Resolution
```bash
curl "http://localhost:3000/api/stream?url=<FEED_URL>&type=podcast&strict=true"
# Should return: { "streamUrl": "https://cdn.../episode.mp3", "source": "podcast" }
```

### Test Playback
1. Go to **Podcasts** tab in app
2. Click any podcast
3. Should play audio (NOT redirect to YouTube)
4. Should NOT show songs in podcast list

---

## Separation Guarantees

✅ **UI Level:**
- Podcast tab ONLY shows podcasts collection
- Song tab ONLY shows songs collection
- Search filters by content type

✅ **API Level:**
- `/api/podcasts` returns from `podcasts` collection ONLY
- `/api/songs` returns from songs collections ONLY

✅ **Playback Level:**
- Podcasts: direct stream → HTML5 audio OR ExoPlayer
- Podcasts: NO YouTube fallback (explicit return null)
- Songs: can use YouTube if stream fails

---

## Debugging

### Monitor Stream Resolution

Check dev server console for logs like:
```
[Podcast Resolver] Input URL: https://feed.example.com/rss
[Podcast Resolver] Feed fetched, size: 45123 bytes
[Podcast Resolver] Resolved audio URL from pattern 0
```

If you see `Feed HTTP error: 404` or `No audio enclosure found`, then:
1. Podcast URL is invalid or inaccessible
2. RSS feed doesn't have audio enclosures
3. URL needs updating

---

## Files Modified

- `src/app/api/stream/route.js` - Improved RSS parsing with redirects
- `src/app/page.js` - Console error suppression, podcast exclusions
- `PORT-CONFIG.md` - Flexible port configuration guide

---

## Next Steps

1. **Fix podcast URLs** in MongoDB (CRITICAL)
2. Test with `curl` to ensure feeds are accessible
3. Test `/api/stream` with your podcast URLs
4. Try playback in app

Once your podcast URLs are fixed, everything else will work!
