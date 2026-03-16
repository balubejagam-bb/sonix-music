'use client';

import { useState, useEffect, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useAuth } from '@/lib/authContext';
import AuthModal from '@/components/AuthModal';
import AddToPlaylistMenu from '@/components/AddToPlaylistMenu';

const NativeMusicPlayer = registerPlugin('MusicPlayer');

function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// Ensure BackgroundMode doesn't crash SSR or Capacitor init
let BackgroundMode = null;
async function getBackgroundMode() {
  if (BackgroundMode) return BackgroundMode;
  if (typeof window === 'undefined') return null;
  try {
    const m = await import('@anuradev/capacitor-background-mode');
    BackgroundMode = m.BackgroundMode;
    return BackgroundMode;
  } catch(e) {
    return null;
  }
}

function getMusicControls() {
  if (typeof window === 'undefined') return null;
  try {
    const mc = window.MusicControls || null;
    if (mc && typeof mc.subscribe === 'function') return mc;
    return null;
  } catch (e) {
    return null;
  }
}

function canUseNativePlugins() {
  // Some Android devices/ROMs crash inside native media/background plugins.
  // Keep playback on the stable web path unless explicitly enabled later.
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() !== 'android';
}

// ─────────────────────── YOUTUBE AUDIO ENGINE ───────────────────────
function useYouTubePlayer() {
  const playerRef = useRef(null);      // YT.Player instance
  const containerRef = useRef(null);   // DOM div element
  const [ytReady, setYtReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const timerRef = useRef(null);
  const onEndRef = useRef(null);
  const pendingVideoIdRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function initPlayer() {
      const el = containerRef.current;
      if (!el) return;
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
      try {
        playerRef.current = new window.YT.Player(el, {
          height: '2', width: '2',
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              setYtReady(true);
              if (pendingVideoIdRef.current) {
                playerRef.current.loadVideoById(pendingVideoIdRef.current);
                playerRef.current.playVideo();
                pendingVideoIdRef.current = null;
              }
            },
            onStateChange: (e) => {
              const S = window.YT.PlayerState;
              if (e.data === S.PLAYING) { setIsPlaying(true); setDuration(playerRef.current.getDuration()); startTimer(); }
              else if (e.data === S.PAUSED) { setIsPlaying(false); stopTimer(); }
              else if (e.data === S.ENDED) { setIsPlaying(false); stopTimer(); if (onEndRef.current) onEndRef.current(); }
            },
            onError: () => { setIsPlaying(false); stopTimer(); },
          },
        });
      } catch (err) { console.error('YT player init failed:', err); }
    }

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); initPlayer(); };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    }
    return () => stopTimer();
  }, []);

  function startTimer() {
    stopTimer();
    timerRef.current = setInterval(() => {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        setCurrentTime(playerRef.current.getCurrentTime());
        setDuration(playerRef.current.getDuration());
      }
    }, 500);
  }
  function stopTimer() { if (timerRef.current) clearInterval(timerRef.current); }

  function isReady() { return playerRef.current && typeof playerRef.current.playVideo === 'function'; }

  async function searchAndPlay(title, artist) {
    try {
      const query = `${title} ${artist} official audio`;
      const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.videoId && isReady()) { playerRef.current.loadVideoById(data.videoId); playerRef.current.playVideo(); return true; }
      const res2 = await fetch(`/api/youtube-search?q=${encodeURIComponent(title + ' ' + artist + ' song')}`);
      const data2 = await res2.json();
      if (data2.videoId && isReady()) { playerRef.current.loadVideoById(data2.videoId); playerRef.current.playVideo(); return true; }
    } catch (e) { console.error('YouTube search failed:', e); }
    return false;
  }

  function play() { if (isReady()) playerRef.current.playVideo(); }
  function pause() { if (isReady()) playerRef.current.pauseVideo(); }

  function playVideoById(vId) {
    if (!vId) return false;
    if (!isReady()) { pendingVideoIdRef.current = vId; return false; }
    playerRef.current.loadVideoById(vId);
    playerRef.current.playVideo();
    return true;
  }

  function seekTo(t) { if (isReady()) playerRef.current.seekTo(t, true); }
  function setVolume(v) { if (isReady()) playerRef.current.setVolume(v); }

  function updateNativeTime(c, d) {
    if (typeof c === 'number' && !isNaN(c)) setCurrentTime(c);
    if (typeof d === 'number' && d > 0) setDuration(d);
  }

  return { containerRef, ytReady, isPlaying, duration, currentTime, searchAndPlay, playVideoById, play, pause, seekTo, setVolume, onEndRef, updateNativeTime };
}

// ─────────────────────── FORMAT TIME ───────────────────────
function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Decode HTML entities like &quot; &amp; &#39;
function decodeHtml(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ─────────────────────── MAIN APP ───────────────────────
export default function Home() {
  const yt = useYouTubePlayer();
  const { user, loading: authLoading, logout, likedSongs, toggleLike, userPlaylists } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [playlistMenuSong, setPlaylistMenuSong] = useState(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]); // array of song objects
  const [userPlaylistSongs, setUserPlaylistSongs] = useState([]); // songs for active user playlist
  const [songs, setSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [totalSongs, setTotalSongs] = useState(0);
  const [page, setPage] = useState(1);
  const [view, setView] = useState('home');
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [genre, setGenre] = useState('');
  const [source, setSource] = useState('all');
  const [volume, setVolumeState] = useState(80);
  const [cachedSongs, setCachedSongs] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoadingSong, setIsLoadingSong] = useState(false);
  const [loadingSongKey, setLoadingSongKey] = useState(null);
  const isLoadingSongRef = useRef(false); // ref-based guard to avoid stale closure issues
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const [ytResults, setYtResults] = useState([]);
  const [isSearchingYT, setIsSearchingYT] = useState(false);
  const [visualizer, setVisualizer] = useState('waves'); // waves, bars, pulse
  const [nativeIsPlaying, setNativeIsPlaying] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off');
  const searchTimer = useRef(null);

  // Use refs for queue to avoid stale closures in next/prev
  const queueRef = useRef([]);
  const queueIndexRef = useRef(0);
  const videoIdCacheRef = useRef(new Map());
  const pendingVideoIdRef = useRef(new Map());
  const controlsBoundRef = useRef(false);
  const nativeControlsEnabledRef = useRef(true);
  const lastNativeTrackKeyRef = useRef(null);
  const nativeAndroid = isNativeAndroid();

  function canPlayNatively(song) {
    return nativeAndroid && typeof song?.url === 'string' && /^https?:\/\//i.test(song.url);
  }

  function buildNativeQueue(sourceQueue = [], selectedSong = null) {
    const queue = sourceQueue
      .filter((s) => typeof s?.url === 'string' && /^https?:\/\//i.test(s.url))
      .map((s) => ({
        url: s.url,
        title: s.title || 'Unknown Track',
        artist: s.artist || 'Unknown Artist',
        album: s.album || 'Sonix Music',
        artwork: s.image || s.thumbnail || '',
      }));

    if (!queue.length && selectedSong && canPlayNatively(selectedSong)) {
      return {
        queue: [{
          url: selectedSong.url,
          title: selectedSong.title || 'Unknown Track',
          artist: selectedSong.artist || 'Unknown Artist',
          album: selectedSong.album || 'Sonix Music',
          artwork: selectedSong.image || selectedSong.thumbnail || '',
        }],
        index: 0,
      };
    }

    const selectedUrl = selectedSong?.url || '';
    const index = Math.max(0, queue.findIndex((s) => s.url === selectedUrl));
    return { queue, index };
  }

  // ───── Load initial data & cache ─────
  useEffect(() => {
    async function initNativeBackground() {
      if (nativeAndroid) {
        try {
          await LocalNotifications.requestPermissions();
        } catch(e) { console.error('Failed to request notification permission:', e); }
      }

      // Request battery optimization exemption for background playback on real devices
      if (nativeAndroid) {
        try {
          const bgMode = await getBackgroundMode();
          if (bgMode) {
            await bgMode.disableWebViewOptimizations();
            const battery = await bgMode.checkBatteryOptimizations();
            if (!battery.disabled) {
              await bgMode.requestDisableBatteryOptimizations();
            }
          }
        } catch(e) { console.error('Battery optimization request error:', e); }
      }
    }
    initNativeBackground();

    const onVisibilityChange = async () => {
      // Redundant with MusicPlaybackService (Media3)
      // if (!canUseNativePlugins() || !BackgroundMode) return;
      // if (!document.hidden) return;
      // try {
      //   await BackgroundMode.enable();
      //   await BackgroundMode.updateNotification({ title: 'Sonix Music', text: 'Playing in background', hidden: false });
      // } catch (e) {
      //   console.error('Background mode resume error:', e);
      // }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    loadPlaylists();
    loadSongs(1);
    backgroundCache();

    // Restore recently played from localStorage
    try {
      const saved = localStorage.getItem('sonix_recent');
      if (saved) setRecentlyPlayed(JSON.parse(saved));
    } catch {}

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Listen to native player for progress updates and web actions
  useEffect(() => {
    if (nativeAndroid) {
      const stateListener = NativeMusicPlayer.addListener('onStateChanged', (res) => {
        if (res) {
          yt.updateNativeTime(res.currentTime || 0, res.duration || 0);
          setNativeIsPlaying(!!res.isPlaying);
          
          // STATE_ENDED = 4 in ExoPlayer
          if (res.playbackState === 4) {
             handleNext();
          }
        }
      });

      const actionListener = NativeMusicPlayer.addListener('onWebAction', (res) => {
        if (res.action === 'next') handleNext();
        if (res.action === 'previous') handlePrev();
      });

      // Fallback polling (less frequent)
      const timer = setInterval(async () => {
        try {
          const res = await NativeMusicPlayer.getPosition();
          if (res && res.currentTime !== undefined) {
             yt.updateNativeTime(res.currentTime, res.duration || 0);
             setNativeIsPlaying(!!res.isPlaying);
          }
        } catch (e) {}
      }, 5000);

      return () => {
        stateListener.remove();
        actionListener.remove();
        clearInterval(timer);
      };
    }
  }, [nativeAndroid]);


  async function fetchJsonWithFallback(paths) {
    for (const url of paths) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        return await res.json();
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  async function searchYouTubeFallback(query, multi = false) {
    const endpoints = [
      `/api/youtube-search?q=${encodeURIComponent(query)}${multi ? '&multi=true' : ''}`,
      `https://sonix-music.vercel.app/api/youtube-search?q=${encodeURIComponent(query)}${multi ? '&multi=true' : ''}`,
    ];
    return fetchJsonWithFallback(endpoints);
  }

  function bindNativeMediaControls() {
    if (!canUseNativePlugins() || controlsBoundRef.current || !nativeControlsEnabledRef.current) return;
    const controls = getMusicControls();
    if (!controls || typeof controls.subscribe !== 'function' || typeof controls.listen !== 'function') {
      nativeControlsEnabledRef.current = false;
      return;
    }

    try {
      controls.subscribe((action) => {
        try {
          let message = '';
          if (typeof action === 'string') {
            try {
              const parsed = JSON.parse(action);
              message = parsed?.message || action;
            } catch {
              message = action;
            }
          } else {
            message = action?.message || '';
          }

          switch (message) {
            case 'music-controls-next':
            case 'music-controls-media-button-next':
              handleNext();
              break;
            case 'music-controls-previous':
            case 'music-controls-media-button-previous':
              handlePrev();
              break;
            case 'music-controls-play':
            case 'music-controls-media-button-play':
              yt.play();
              break;
            case 'music-controls-pause':
            case 'music-controls-media-button-pause':
              yt.pause();
              break;
            case 'music-controls-toggle-play-pause':
            case 'music-controls-media-button-play-pause':
              if (yt.isPlaying) yt.pause();
              else yt.play();
              break;
            case 'music-controls-destroy':
              yt.pause();
              break;
            default:
              break;
          }
        } catch (e) {
          console.error('MusicControls event error:', e);
        }
      });
      controls.listen();
      controlsBoundRef.current = true;
    } catch (e) {
      console.error('MusicControls bind error:', e);
      nativeControlsEnabledRef.current = false;
    }
  }

  function syncNativeMediaControls(song, playing) {
    if (!canUseNativePlugins() || !song || !nativeControlsEnabledRef.current) return;
    const controls = getMusicControls();
    if (!controls) return;

    const cover = song.thumbnail || song.image || (song.videoId ? `https://img.youtube.com/vi/${song.videoId}/mqdefault.jpg` : '');
    const trackKey = song.songId || song.videoId || `${song.title || ''}::${song.artist || ''}`;

    try {
      if (lastNativeTrackKeyRef.current !== trackKey && typeof controls.create === 'function') {
        // Use a safe cover - avoid long URLs that can crash native side
        const safeCover = cover && cover.length < 500 ? cover : '';
        controls.create({
          track: (song.title || 'Unknown Track').substring(0, 100),
          artist: (song.artist || 'Unknown Artist').substring(0, 100),
          album: (song.album || 'Sonix Music').substring(0, 100),
          cover: safeCover,
          isPlaying: !!playing,
          dismissable: true,
          hasPrev: true,
          hasNext: true,
          hasClose: true,
          ticker: (song.title || 'Sonix Music').substring(0, 100)
        }, () => {
          lastNativeTrackKeyRef.current = trackKey;
        }, (err) => {
          console.error('MusicControls create error:', err);
          nativeControlsEnabledRef.current = false;
        });
      }

      if (lastNativeTrackKeyRef.current === trackKey && typeof controls.updateIsPlaying === 'function') {
        controls.updateIsPlaying(!!playing);
      }
    } catch (e) {
      console.error('MusicControls sync error:', e);
      nativeControlsEnabledRef.current = false;
    }
  }

  async function loadPlaylists() {
    try {
      const res = await fetch('/api/playlists');
      const data = await res.json();
      setPlaylists(data.playlists || []);
    } catch (e) { console.error('Failed to load playlists', e); }
  }

  async function loadSongs(p, options = {}) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: p, limit: 50,
        ...(options.search && { search: options.search }),
        ...(options.genre && { genre: options.genre }),
        ...(options.source && options.source !== 'all' && { source: options.source }),
      });
      const res = await fetch(`/api/songs?${params}`);
      const data = await res.json();
      if (p === 1) { setSongs(data.songs || []); }
      else { setSongs(prev => [...prev, ...(data.songs || [])]); }
      setTotalSongs(data.total || 0);
      setPage(p);
    } catch (e) { console.error('Failed to load songs', e); }
    setLoading(false);
  }

  function songKey(song) {
    return song.songId || song._id || song.videoId || `${song.title || ''}::${song.artist || ''}`;
  }

  async function resolveSongVideoId(song) {
    if (!song) return null;
    if (song.videoId) {
      videoIdCacheRef.current.set(songKey(song), song.videoId);
      return song.videoId;
    }

    const key = songKey(song);
    const cachedVideoId = videoIdCacheRef.current.get(key);
    if (cachedVideoId) return cachedVideoId;

    if (pendingVideoIdRef.current.has(key)) {
      return pendingVideoIdRef.current.get(key);
    }

    const query = `${song.title || ''} ${song.artist || ''} official audio`.trim();
    const task = searchYouTubeFallback(query)
      .then(data => {
        if (data?.videoId) {
          videoIdCacheRef.current.set(key, data.videoId);
          return data.videoId;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        pendingVideoIdRef.current.delete(key);
      });

    pendingVideoIdRef.current.set(key, task);
    return task;
  }

  function prefetchUpcomingVideoIds() {
    const q = queueRef.current;
    if (!q.length) return;

    for (let step = 1; step <= 3; step++) {
      const idx = (queueIndexRef.current + step) % q.length;
      const nextSong = q[idx];
      if (!nextSong) continue;
      resolveSongVideoId(nextSong).catch(() => {});
    }
  }

  async function backgroundCache() {
    try {
      const res = await fetch('/api/songs?all=true');
      const data = await res.json();
      const allSongs = data.songs || [];
      setCachedSongs(allSongs);

      // Warm videoId cache so next/prev is instant for already indexed songs.
      allSongs.forEach((song) => {
        if (song?.videoId) {
          videoIdCacheRef.current.set(songKey(song), song.videoId);
        }
      });

      try {
        localStorage.setItem('sonix_cache', JSON.stringify(allSongs.slice(0, 2500)));
        localStorage.setItem('sonix_cache_time', Date.now().toString());
      } catch(e) {}
    } catch (e) {
      try {
        const cached = localStorage.getItem('sonix_cache');
        if (cached) { setCachedSongs(JSON.parse(cached)); }
      } catch(e2) {}
    }
  }

  // ───── Search ─────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) { setSearchResults([]); setYtResults([]); setIsSearching(false); return; }

    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      const q = search.trim();

      // Instant local filter from cache (shows immediately)
      const localQ = q.toLowerCase();
      const localHits = cachedSongs.filter(s =>
        s.title?.toLowerCase().includes(localQ) ||
        s.artist?.toLowerCase().includes(localQ) ||
        s.album?.toLowerCase().includes(localQ)
      ).slice(0, 30);
      setSearchResults(localHits);

      try {
        // Hit hybrid search API — DB + YouTube fallback in one call
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();

        if (data.songs?.length) setSearchResults(data.songs);
        else if (localHits.length === 0) setSearchResults([]);

        // Auto-show YouTube results if DB had < 5 hits
        if (data.ytResults?.length) {
          setYtResults(data.ytResults);
        } else if ((data.songs?.length || 0) < 5 && localHits.length < 5) {
          // Still not enough — trigger YouTube search directly
          setIsSearchingYT(true);
          searchYouTubeFallback(q, true)
            .then(d => {
              // /api/youtube-search returns { results: [] } or array directly
              const arr = Array.isArray(d) ? d : (d?.results || []);
              if (arr.length) setYtResults(arr);
            })
            .catch(() => {})
            .finally(() => setIsSearchingYT(false));
        }
      } catch {
        // Fallback to local results only
      }

      setIsSearching(false);
    }, 400);
  }, [search, cachedSongs]);

  async function searchGlobalYT() {
    if (!search.trim()) return;
    setIsSearchingYT(true);
    try {
      const data = await searchYouTubeFallback(search, true);
      setYtResults(data.results || []);
    } catch(e) { console.error('YT Global search failed', e); }
    setIsSearchingYT(false);
  }

  // ───── Play song (core function) ─────
  async function playSongDirect(song, songList, force = false) {
    // Use ref-based guard so next/prev can always bypass
    if (isLoadingSongRef.current && !force) return;
    isLoadingSongRef.current = true;

    const key = songKey(song);
    setIsLoadingSong(true);
    setLoadingSongKey(key);

    if (songList) {
      const idx = songList.findIndex(s => songKey(s) === key);
      queueRef.current = songList;
      queueIndexRef.current = idx >= 0 ? idx : 0;
    }

    try {
      // On Android: resolve to a direct playable stream URL
      if (nativeAndroid) {
        try {
          let streamUrl = null;
          let videoId = song.videoId;

          // If song has a JioSaavn/page URL, resolve it to a real stream
          if (song.url) {
            const res = await fetch(
              `/api/stream?url=${encodeURIComponent(song.url)}&title=${encodeURIComponent(song.title || '')}&artist=${encodeURIComponent(song.artist || '')}`
            );
            const data = await res.json();
            if (data.streamUrl) streamUrl = data.streamUrl;
          }

          // If no stream yet, search YouTube with stream=true
          if (!streamUrl) {
            const query = `${song.title || ''} ${song.artist || ''} official audio`.trim();
            const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(query)}&stream=true`);
            const data = await res.json();
            if (data.videoId) videoId = data.videoId;
            if (data.streamUrl) streamUrl = data.streamUrl;
          }

          if (streamUrl) {
            const songWithUrl = { ...song, url: streamUrl, videoId: videoId || song.videoId };
            const queueSource = songList || queueRef.current || [];

            yt.pause();
            await NativeMusicPlayer.playQueue({
              queue: [{
                url: streamUrl,
                title: song.title || 'Unknown Track',
                artist: song.artist || 'Unknown Artist',
                album: song.album || 'Sonix Music',
                artwork: song.thumbnail || song.image || (videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : ''),
              }],
              index: 0,
              shuffle: shuffleEnabled,
              repeatMode,
            });

            queueRef.current = queueSource.length ? queueSource : [songWithUrl];
            queueIndexRef.current = queueSource.findIndex(s => songKey(s) === key) || 0;
            setCurrentSong(songWithUrl);
            setNativeIsPlaying(true);
            isLoadingSongRef.current = false;
            setIsLoadingSong(false);
            setLoadingSongKey(null);
            prefetchUpcomingVideoIds();
            return;
          }
        } catch (nativeErr) {
          console.error('Native playback error, falling back to web:', nativeErr);
        }
      }

      // Web fallback (browser / non-Android)
      const resolvedVideoId = await resolveSongVideoId(song);
      const playableSong = resolvedVideoId && !song.videoId ? { ...song, videoId: resolvedVideoId } : song;

      // Clear loading state NOW — don't wait for YT to start playing
      setCurrentSong(playableSong);
      setNativeIsPlaying(false);
      isLoadingSongRef.current = false;
      setIsLoadingSong(false);
      setLoadingSongKey(null);

      if (resolvedVideoId) {
        const started = yt.playVideoById(resolvedVideoId);
        if (!started && yt.ytReady) {
          yt.searchAndPlay(song.title, song.artist);
        }
      } else {
        yt.searchAndPlay(song.title, song.artist);
      }

      // Track recently played (local + persisted)
      setRecentlyPlayed(prev => {
        const filtered = prev.filter(s => songKey(s) !== songKey(playableSong));
        const next = [playableSong, ...filtered].slice(0, 20);
        try { localStorage.setItem('sonix_recent', JSON.stringify(next)); } catch {}
        return next;
      });

      // Track on server if logged in
      const token = typeof window !== 'undefined' ? localStorage.getItem('sonix_token') : null;
      if (token) {
        const sid = songKey(playableSong);
        fetch(`/api/user/recent/${encodeURIComponent(sid)}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }
        }).catch(() => {});
      }

      prefetchUpcomingVideoIds();

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: playableSong.title,
          artist: playableSong.artist,
          album: playableSong.album || 'Sonix Music',
          artwork: [{
            src: playableSong.thumbnail || playableSong.image || `https://img.youtube.com/vi/${playableSong.videoId}/mqdefault.jpg`,
            sizes: '512x512',
            type: 'image/jpeg'
          }]
        });
        navigator.mediaSession.setActionHandler('play', () => yt.play());
        navigator.mediaSession.setActionHandler('pause', () => yt.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => handlePrev());
        navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
      }

      bindNativeMediaControls();
      syncNativeMediaControls(playableSong, true);
    } catch (e) {
      console.error('Playback error:', e);
    } finally {
      // Always ensure loading is cleared
      isLoadingSongRef.current = false;
      setIsLoadingSong(false);
      setLoadingSongKey(null);
    }
  }

  useEffect(() => {
    if (!currentSong) return;
    syncNativeMediaControls(currentSong, yt.isPlaying);
  }, [currentSong, yt.isPlaying]);

  useEffect(() => {
    return () => {
      if (!canUseNativePlugins()) return;
      const controls = getMusicControls();
      if (controls && typeof controls.destroy === 'function') {
        try {
          controls.destroy();
        } catch (e) {
          console.error('MusicControls destroy error:', e);
        }
      }
    };
  }, []);

  // ───── Next / Prev using refs (never stale) ─────
  function handleNext() {
    const q = queueRef.current;
    if (!q || q.length === 0) return;
    let nextIdx;
    if (shuffleEnabled) {
      nextIdx = Math.floor(Math.random() * q.length);
    } else {
      nextIdx = (queueIndexRef.current + 1) % q.length;
    }
    queueIndexRef.current = nextIdx;
    isLoadingSongRef.current = false; // force-reset guard
    playSongDirect(q[nextIdx], null, true);
  }

  function handlePrev() {
    const q = queueRef.current;
    if (!q || q.length === 0) return;
    const prevIdx = queueIndexRef.current <= 0 ? q.length - 1 : queueIndexRef.current - 1;
    queueIndexRef.current = prevIdx;
    isLoadingSongRef.current = false; // force-reset guard
    playSongDirect(q[prevIdx], null, true);
  }

  // Auto-play next on song end
  useEffect(() => {
    yt.onEndRef.current = handleNext;
  });

  // ───── Open playlist ─────
  async function openPlaylist(pl) {
    setView('playlist');
    setActivePlaylist(pl);
    setMobileMenuOpen(false);
    setLoading(true);
    try {
      const col = pl.collection || 'songs';
      const res = await fetch(`/api/songs?source=${col === 'songs' ? 'jiosaavn' : 'spotify'}&limit=50`);
      const data = await res.json();
      let filtered = data.songs;
      if (pl.songIds?.length) {
        const ids = new Set(pl.songIds);
        const fromCache = cachedSongs.filter(s => ids.has(s.songId));
        if (fromCache.length > 0) filtered = fromCache;
      }
      setSongs(filtered);
    } catch (e) {}
    setLoading(false);
  }

  // ───── Open user-created playlist ─────
  async function openUserPlaylist(pl) {
    setActivePlaylist(pl);
    setView('userplaylist');
    setMobileMenuOpen(false);

    if (!pl.songs?.length) {
      setUserPlaylistSongs([]);
      return;
    }

    const idSet = new Set(pl.songs.map(String));

    // Match against cachedSongs first (fast path)
    const fromCache = cachedSongs.filter(s => {
      const k = s.songId || s._id?.toString() || s.videoId;
      return k && idSet.has(String(k));
    });

    if (fromCache.length > 0) {
      setUserPlaylistSongs(fromCache);
      return;
    }

    // Fallback: fetch playlist details from API
    try {
      const token = localStorage.getItem('sonix_token');
      const res = await fetch(`/api/playlist/${pl._id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const songIds = data.playlist?.songs || [];
      if (!songIds.length) { setUserPlaylistSongs([]); return; }

      const freshIds = new Set(songIds.map(String));
      const matched = cachedSongs.filter(s => {
        const k = s.songId || s._id?.toString() || s.videoId;
        return k && freshIds.has(String(k));
      });
      setUserPlaylistSongs(matched);
    } catch {
      setUserPlaylistSongs([]);
    }
  }

  function filterGenre(g) {
    setGenre(g);
    setView('home');
    setMobileMenuOpen(false);
    loadSongs(1, { genre: g, source });
  }

  function filterSource(s) {
    setSource(s);
    loadSongs(1, { genre, source: s });
  }

  function handleVolume(v) {
    setVolumeState(v);
    if (!nativeAndroid) {
      yt.setVolume(v);
    }
  }

  async function handlePlayPauseToggle() {
    if (nativeAndroid && currentSong) {
      try {
        if (nativeIsPlaying) {
          await NativeMusicPlayer.pause();
          setNativeIsPlaying(false);
        } else {
          await NativeMusicPlayer.resume();
          setNativeIsPlaying(true);
        }
      } catch (e) {
        console.error('Native play/pause failed:', e);
      }
      return;
    }
    if (yt.isPlaying) yt.pause();
    else yt.play();
  }

  function handleSeek(timeInSeconds) {
    if (nativeAndroid && currentSong) {
      NativeMusicPlayer.seekTo({ positionMs: timeInSeconds * 1000 });
    } else {
      yt.seekTo(timeInSeconds);
    }
  }

  async function handleToggleShuffle() {
    const next = !shuffleEnabled;
    setShuffleEnabled(next);
    if (nativeAndroid) {
      try {
        await NativeMusicPlayer.setShuffle({ enabled: next });
      } catch (e) {
        console.error('Native shuffle failed:', e);
      }
    }
  }

  async function handleCycleRepeat() {
    const order = ['off', 'all', 'one'];
    const idx = order.indexOf(repeatMode);
    const next = order[(idx + 1) % order.length];
    setRepeatMode(next);
    if (nativeAndroid) {
      try {
        await NativeMusicPlayer.setRepeatMode({ mode: next });
      } catch (e) {
        console.error('Native repeat failed:', e);
      }
    }
  }

  const activePlaying = nativeAndroid ? nativeIsPlaying : yt.isPlaying;
  const repeatLabel = repeatMode === 'off' ? '🔁' : repeatMode === 'one' ? '🔂' : '🔁';

  // Gestures for full player
  const touchStartX = useRef(0);
  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(diff) > 70) {
      if (diff > 0) handlePrev();
      else handleNext();
    }
  };

  function loadMore() { loadSongs(page + 1, { search, genre, source }); }

  const displaySongs = search.trim() ? searchResults : songs;
  // For liked view, filter cachedSongs by likedSongs set
  const likedSongsList = cachedSongs.filter(s => {
    const k = s.songId || s._id || s.videoId || `${s.title || ''}::${s.artist || ''}`;
    return likedSongs.has(k);
  });
  const activeSongs = (view === 'liked' && !search.trim())
    ? likedSongsList
    : (view === 'recent' && !search.trim())
      ? recentlyPlayed
      : (view === 'userplaylist' && !search.trim())
        ? userPlaylistSongs
        : displaySongs;

  return (
    <div className="app-layout">
      {/* Mobile Menu Toggle */}
      <button
        className={`mobile-menu-btn ${mobileMenuOpen ? 'hidden' : ''}`}
        onClick={() => setMobileMenuOpen(true)}
        aria-label="Open menu"
      >
        ☰
      </button>

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <h1 className="sidebar-brand">
            SONIX MUSIC <span className="sidebar-brand-tag">-TJ</span>
          </h1>
          <button
            className="sidebar-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section-title">Menu</div>
          <button className={`nav-item ${view === 'home' && !genre ? 'active' : ''}`} onClick={() => { setView('home'); setGenre(''); loadSongs(1); setMobileMenuOpen(false); }}>
            <span className="icon">🏠</span> Home
          </button>
          <button className={`nav-item ${view === 'search' ? 'active' : ''}`} onClick={() => { setView('search'); setMobileMenuOpen(false); }}>
            <span className="icon">🔍</span> Search
          </button>

          <div className="nav-section-title">Your Library</div>
          <button className={`nav-item ${view === 'home' && !genre ? 'active' : ''}`} onClick={() => { setView('home'); setGenre(''); loadSongs(1); setMobileMenuOpen(false); }}>
            <span className="icon">🎶</span> All Songs
          </button>

          {user ? (
            <>
              <button className={`nav-item ${view === 'liked' ? 'active' : ''}`} onClick={() => { setView('liked'); setMobileMenuOpen(false); }}>
                <span className="icon">💚</span> Liked Songs
                {likedSongs.size > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>{likedSongs.size}</span>}
              </button>
              <button className={`nav-item ${view === 'recent' ? 'active' : ''}`} onClick={() => { setView('recent'); setMobileMenuOpen(false); }}>
                <span className="icon">🕐</span> Recently Played
                {recentlyPlayed.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>{recentlyPlayed.length}</span>}
              </button>

              {userPlaylists.length > 0 && (
                <>
                  <div className="nav-section-title">My Playlists</div>
                  {userPlaylists.map((pl) => (
                    <button key={pl._id} className={`nav-item ${activePlaylist?._id === pl._id ? 'active' : ''}`}
                      onClick={() => openUserPlaylist(pl)}>
                      <span className="icon">🎵</span> {pl.name}
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>{pl.songs?.length || 0}</span>
                    </button>
                  ))}
                </>
              )}
            </>
          ) : (
            <button className="nav-item" style={{ color: '#7c3aed', fontWeight: 600 }} onClick={() => { setShowAuthModal(true); setMobileMenuOpen(false); }}>
              <span className="icon">🔐</span> Log In to see your library
            </button>
          )}

          <div className="nav-section-title">Browse</div>
          {playlists.map((pl, i) => (
            <button key={i} className={`nav-item ${activePlaylist?.name === pl.name ? 'active' : ''}`} onClick={() => openPlaylist(pl)}>
              <span className="icon">{pl.name.split(' ')[0]}</span> {pl.name.slice(pl.name.indexOf(' ') + 1)}
            </button>
          ))}

          {/* Account */}
          <div className="nav-section-title">Account</div>
          {user ? (
            <>
              <div style={{ padding: '6px 16px 2px', color: '#9ca3af', fontSize: 12 }}>👤 {user.name}</div>
              <button className="nav-item" onClick={() => { logout(); setMobileMenuOpen(false); }}>
                <span className="icon">🚪</span> Log Out
              </button>
            </>
          ) : (
            <button className="nav-item" onClick={() => { setShowAuthModal(true); setMobileMenuOpen(false); }}>
              <span className="icon">🔐</span> Log In / Sign Up
            </button>
          )}

          <div className="sidebar-bottom-space" aria-hidden="true"></div>

          {/* Hidden File Input */}
          <input
            type="file"
            id="music-upload-input"
            style={{ display: 'none' }}
            accept=".csv, .mp3, .wav"
            multiple
            onChange={async (e) => {
              if (e.target.files && e.target.files.length > 0) {
                const count = e.target.files.length;
                alert(`Preparing to sync ${count} file(s) with the Global Database...`);
                try {
                  const songData = Array.from(e.target.files).map(f => ({
                    title: f.name.replace(/\.[^/.]+$/, ""),
                    artist: 'Self Upload',
                    album: 'My Library'
                  }));
                  const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(songData)
                  });
                  const data = await res.json();
                  if (data.success) {
                    alert(`✅ SUCCESS: ${data.count} items indexed!\n\nRefresh or Search to see your songs in the library.`);
                    loadSongs(1);
                  } else {
                    alert('Upload failed: ' + data.error);
                  }
                } catch(err) {
                  alert('Sync Error: ' + err.message);
                }
              }
            }}
          />
        </nav>
      </aside>

      {/* Mobile overlay */}
      {mobileMenuOpen && <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)}></div>}

      {/* Main Content */}
      <main className="main-content">
        <div className="search-container">
          <div className="search-box">
            <span className="icon">🔍</span>
            <input
              type="text"
              placeholder="Search songs, artists, albums..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setView('search')}
            />
            {search && (
              <button style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '16px' }} onClick={() => setSearch('')}>✕</button>
            )}
          </div>
        </div>

        <div className="content-scroll">
          {view === 'home' && !search.trim() && (
            <>
              {playlists.length > 0 && (
                <>
                  <div className="section-header fade-in"><h2>Featured Playlists</h2></div>
                  <div className="playlist-row fade-in">
                    {playlists.map((pl, i) => (
                      <div key={i} className="playlist-card" onClick={() => openPlaylist(pl)}>
                        <div className="card-bg" style={{ background: pl.cover ? `url(${pl.cover}) center/cover` : pl.gradient }}>
                          <div className="play-overlay">▶</div>
                          <div className="card-info">
                            <div className="card-name">{pl.name}</div>
                            <div className="card-desc">{pl.description}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="section-header fade-in">
                <h2>{genre ? `${genre} Songs` : 'All Songs'}</h2>
                <span style={{ color: '#9ca3af', fontSize: '13px' }}>{totalSongs.toLocaleString()} tracks</span>
              </div>
              <div className="filter-pills fade-in">
                <button className={`pill ${source === 'all' ? 'active' : ''}`} onClick={() => filterSource('all')}>All</button>
                <button className={`pill ${source === 'jiosaavn' ? 'active' : ''}`} onClick={() => filterSource('jiosaavn')}>JioSaavn</button>
                <button className={`pill ${source === 'spotify' ? 'active' : ''}`} onClick={() => filterSource('spotify')}>Spotify</button>
              </div>
            </>
          )}

          {view === 'playlist' && activePlaylist && !search.trim() && (
            <div className="section-header fade-in">
              <div>
                <h2>{activePlaylist.name}</h2>
                <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: '4px' }}>{activePlaylist.description}</p>
              </div>
              <button className="view-all" onClick={() => { setView('home'); loadSongs(1); }}>← Back</button>
            </div>
          )}

          {view === 'liked' && !search.trim() && (
            <div className="section-header fade-in">
              <div>
                <h2>💚 Liked Songs</h2>
                <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: '4px' }}>{likedSongs.size} songs</p>
              </div>
              <button className="view-all" onClick={() => { setView('home'); loadSongs(1); }}>← Back</button>
            </div>
          )}

          {view === 'recent' && !search.trim() && (
            <div className="section-header fade-in">
              <div>
                <h2>🕐 Recently Played</h2>
                <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: '4px' }}>{recentlyPlayed.length} songs</p>
              </div>
              <button className="view-all" onClick={() => { setView('home'); loadSongs(1); }}>← Back</button>
            </div>
          )}

          {view === 'userplaylist' && activePlaylist && !search.trim() && (
            <div className="section-header fade-in">
              <div>
                <h2>🎵 {activePlaylist.name}</h2>
                <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: '4px' }}>{userPlaylistSongs.length} songs</p>
              </div>
              <button className="view-all" onClick={() => { setView('home'); loadSongs(1); }}>← Back</button>
            </div>
          )}

          {(view === 'search' || search.trim()) && (
            <div className="section-header fade-in">
              <h2>{search.trim() ? `Results for "${search}"` : 'Search'}</h2>
              <span style={{ color: '#9ca3af', fontSize: '13px' }}>{searchResults.length} results</span>
            </div>
          )}

          <div className="song-list">
            {activeSongs.map((song, i) => {
              const key = song.songId || song._id || song.videoId || `${song.title || ''}::${song.artist || ''}`;
              const isLiked = likedSongs.has(key);
              const isCurrentSong = currentSong && songKey(currentSong) === key;
              return (
              <div
                key={song._id || song.songId || song.videoId || i}
                className={`song-row fade-in ${isCurrentSong ? 'playing' : ''}`}
                style={{ animationDelay: `${Math.min(i * 30, 500)}ms` }}
                onClick={() => playSongDirect(song, activeSongs)}
              >
                <span className="song-num">
                  {loadingSongKey === key ? (
                    <span className="song-loading-spinner" aria-label="Loading song"></span>
                  ) : isCurrentSong ? (
                    <span className="equalizer">
                      <span className="bar"></span><span className="bar"></span><span className="bar"></span>
                    </span>
                  ) : i + 1}
                </span>
                {song.image ? (
                  <img className="song-img" src={song.image} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                ) : (
                  <div className="song-img" style={{ background: 'var(--gradient-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🎵</div>
                )}
                <div className="song-details">
                  <div className="song-title">{decodeHtml(song.title)}</div>
                  <div className="song-artist">{decodeHtml(song.artist)}</div>
                </div>
                <div className="song-album">{song.album}</div>
                <div className="song-duration">{song.duration ? fmt(song.duration) : '-'}</div>
                {user && (
                  <div className="song-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="song-action-btn"
                      title={isLiked ? 'Unlike' : 'Like'}
                      onClick={() => toggleLike(key)}
                      style={{ color: isLiked ? '#1db954' : '#6b7280' }}
                    >
                      {isLiked ? '💚' : '🤍'}
                    </button>
                    <button
                      className="song-action-btn"
                      title="Add to playlist"
                      onClick={() => setPlaylistMenuSong(song)}
                    >
                      ⊕
                    </button>
                  </div>
                )}
              </div>
              );
            })}
          </div>

          {loading && <div className="spinner"></div>}

          {!loading && !search.trim() && displaySongs.length > 0 && displaySongs.length < totalSongs && (
            <div style={{ textAlign: 'center', padding: '24px' }}>
              <button className="pill" onClick={loadMore} style={{ padding: '10px 32px' }}>Load More</button>
            </div>
          )}

            {/* YouTube Results Grid */}
            {ytResults.length > 0 && (
              <>
                <div className="section-header fade-in" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
                  <h2>YouTube Discovery</h2>
                  <span style={{ color: '#ff0000', fontSize: '13px', fontWeight: 'bold' }}>YT GLOBAL</span>
                </div>
                <div className="song-list">
                  {ytResults.map((v, i) => (
                    <div 
                      key={v.videoId} 
                      className={`song-row fade-in ${currentSong?.videoId === v.videoId ? 'playing' : ''}`}
                      onClick={() => playSongDirect({ ...v, image: v.thumbnail }, ytResults)}
                    >
                      <span className="song-num">🌐</span>
                      <img className="song-img" src={v.thumbnail} alt="" loading="lazy" />
                      <div className="song-details">
                        <div className="song-title">{v.title}</div>
                        <div className="song-artist">{v.artist}</div>
                      </div>
                      <div className="song-duration">YouTube</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Global Search Trigger */}
            {search.trim() && !loading && (
              <div style={{ textAlign: 'center', padding: displaySongs.length === 0 && ytResults.length === 0 ? '60px 20px' : '40px 0' }}>
                {displaySongs.length === 0 && ytResults.length === 0 && (
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
                )}
                <p style={{ color: '#9ca3af', marginBottom: '20px', fontSize: '14px' }}>
                  {displaySongs.length === 0 && ytResults.length === 0 ? "Not in Library." : "Can't find a specific version?"}
                </p>
                <button 
                  className="pill active" 
                  style={{ padding: '12px 32px', borderRadius: '50px', background: 'var(--accent-primary)', color: '#000', fontWeight: 'bold' }}
                  onClick={searchGlobalYT}
                  disabled={isSearchingYT}
                >
                  {isSearchingYT ? '⏳ Searching YouTube...' : '🌐 Search Global YouTube'}
                </button>
              </div>
            )}

            {!loading && !search.trim() && displaySongs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎵</div>
                <p>Welcome back! Start searching to listen.</p>
              </div>
            )}
        </div>
      </main>

      {/* Player Bar (Minimised) */}
      <div className={`player-bar ${fullPlayerOpen ? 'hidden' : ''}`} onClick={(e) => {
        // Only open full player if clicked outside controls
        if (e.target.closest('.player-controls') || e.target.closest('.player-extra')) return;
        if (currentSong) setFullPlayerOpen(true);
      }}>
        {currentSong ? (
          <>
            <div className="player-song-info">
              {currentSong.image ? (
                <img src={currentSong.image} alt="" />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--gradient-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }}>🎵</div>
              )}
              <div className="info">
                <div className="title">{decodeHtml(currentSong.title)}</div>
                <div className="artist">{decodeHtml(currentSong.artist)}</div>
              </div>
            </div>

            <div className="player-controls">
              <div className="player-buttons">
                <button className="hide-mobile" title="Shuffle" onClick={(e) => { e.stopPropagation(); handleToggleShuffle(); }}>
                  {shuffleEnabled ? '🔀' : '➡️'}
                </button>
                <button onClick={(e) => { e.stopPropagation(); handlePrev(); }} title="Previous">⏮</button>
                <button className="play-pause-btn" onClick={(e) => { e.stopPropagation(); handlePlayPauseToggle(); }}>
                  {isLoadingSong ? <div className="spinner-small"></div> : activePlaying ? '⏸' : '▶'}
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleNext(); }} title="Next">⏭</button>
                <button className="hide-mobile" title="Repeat" onClick={(e) => { e.stopPropagation(); handleCycleRepeat(); }}>{repeatLabel}</button>
              </div>
              <div className="player-progress">
                <span className="time">{fmt(yt.currentTime)}</span>
                <div className="progress-track" onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - rect.left) / rect.width;
                  yt.updateNativeTime(pct * yt.duration);
                  handleSeek(pct * yt.duration);
                }}>
                  <div className="progress-filled" style={{ width: yt.duration ? `${(yt.currentTime / yt.duration) * 100}%` : '0%' }}></div>
                </div>
                <span className="time">{fmt(yt.duration)}</span>
              </div>
            </div>

            <div className="player-extra">
              <div className="volume-control">
                <button onClick={(e) => { e.stopPropagation(); handleVolume(volume > 0 ? 0 : 80); }}>
                  {volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'}
                </button>
                <div className="volume-track" onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const v = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                  handleVolume(Math.max(0, Math.min(100, v)));
                }}>
                  <div className="volume-filled" style={{ width: `${volume}%` }}></div>
                </div>
              </div>
              <button 
                title="Open Player" 
                onClick={(e) => { e.stopPropagation(); setFullPlayerOpen(true); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px', marginLeft: '12px' }}>
                ⛶
              </button>
            </div>
          </>
        ) : (
          <div className="player-placeholder">
            <span>🎵 Select a song to start playing</span>
          </div>
        )}
      </div>

      {/* Full Screen Player & Visualizer */}
      <div className={`full-player ${fullPlayerOpen ? 'open' : ''}`}>
        {currentSong && (
          <div className="full-player-content">
            <button className="close-full-player" onClick={() => setFullPlayerOpen(false)}>▼</button>
            
            {/* Visualizer Background */}
            <div className={`visualizer-bg ${visualizer} ${activePlaying ? 'playing' : ''}`}></div>

            <div className="full-player-grid">
              <div className="full-player-left">
                <div 
                  className={`artwork-container ${activePlaying ? 'playing' : ''}`}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                >
                  <div className="vinyl-overlay">
                    <div className="vinyl-lines"></div>
                    <div className="vinyl-center"></div>
                  </div>
                  {currentSong.image ? (
                    <img src={currentSong.image} className={`artwork ${activePlaying ? 'spin' : ''}`} alt="" />
                  ) : (
                    <div className="artwork placeholder">🎵</div>
                  )}
                </div>
              </div>

              <div className="full-player-right">
                <div className="song-meta">
                  <div className="title">{decodeHtml(currentSong.title)}</div>
                  <div className="artist">{decodeHtml(currentSong.artist)}</div>
                </div>

                <div className="audio-beats-panel">
                  <div className="panel-title">Visual Experience</div>
                  <div className="visualizer-options">
                    <button className={visualizer === 'waves' ? 'active' : ''} onClick={() => setVisualizer('waves')}>Fluid Waves</button>
                    <button className={visualizer === 'bars' ? 'active' : ''} onClick={() => setVisualizer('bars')}>Neon Bars</button>
                    <button className={visualizer === 'pulse' ? 'active' : ''} onClick={() => setVisualizer('pulse')}>Atmosphere</button>
                  </div>
                  <p className="note">Premium Visualizer Active</p>
                </div>

                <div className="progress-container">
                  <div className="time-row">
                    <span>{fmt(yt.currentTime)}</span>
                    <span>{fmt(yt.duration)}</span>
                  </div>
                  <div className="progress-track-lg" onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    yt.updateNativeTime(pct * yt.duration);
                    handleSeek(pct * yt.duration);
                  }}>
                    <div className="progress-filled" style={{ width: yt.duration ? `${(yt.currentTime / yt.duration) * 100}%` : '0%' }}></div>
                  </div>
                </div>

                <div className="controls-row-lg">
                  <button className="icon-btn" onClick={handleToggleShuffle}>{shuffleEnabled ? '🔀' : '➡️'}</button>
                  <button className="icon-btn skip" onClick={handlePrev}>⏮</button>
                  <button className="play-pause-btn-lg" onClick={handlePlayPauseToggle}>
                    {isLoadingSong ? <div className="spinner-small"></div> : activePlaying ? '⏸' : '▶'}
                  </button>
                  <button className="icon-btn skip" onClick={handleNext}>⏭</button>
                  <button className="icon-btn" onClick={handleCycleRepeat}>{repeatLabel}</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Hidden YouTube player mount point — ref-based, no ID conflict */}
      <div
        ref={yt.containerRef}
        style={{ position: 'fixed', bottom: 0, left: 0, width: '2px', height: '2px', opacity: 0, pointerEvents: 'none', zIndex: -1 }}
        aria-hidden="true"
      />

      {/* Auth Modal */}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      {/* Add to Playlist Menu */}
      {playlistMenuSong && (
        <AddToPlaylistMenu song={playlistMenuSong} onClose={() => setPlaylistMenuSong(null)} />
      )}

      {/* Login nudge banner — only when not logged in, hidden when modal is open */}
      {!authLoading && !user && !showAuthModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 500,
          background: 'linear-gradient(90deg, #7c3aed, #1db954)',
          padding: '9px 20px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12,
        }}>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>
            🎵 Log in to like songs, create playlists &amp; sync across devices
          </span>
          <button
            onClick={() => setShowAuthModal(true)}
            style={{ background: '#fff', color: '#7c3aed', border: 'none', borderRadius: 20, padding: '5px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
          >
            Log In
          </button>
        </div>
      )}
    </div>
  );
}
