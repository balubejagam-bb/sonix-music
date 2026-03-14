'use client';

import { useState, useEffect, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeMusicPlayer = registerPlugin('MusicPlayer');

function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// Ensure BackgroundMode doesn't crash SSR
let BackgroundMode;
if (typeof window !== 'undefined') {
  import('@anuradev/capacitor-background-mode').then(m => { BackgroundMode = m.BackgroundMode; }).catch(()=> {});
}

function getMusicControls() {
  if (typeof window === 'undefined') return null;
  return window.MusicControls || null;
}

function canUseNativePlugins() {
  // Some Android devices/ROMs crash inside native media/background plugins.
  // Keep playback on the stable web path unless explicitly enabled later.
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() !== 'android';
}

// ─────────────────────── YOUTUBE AUDIO ENGINE ───────────────────────
function useYouTubePlayer() {
  const playerRef = useRef(null);
  const [ytReady, setYtReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const timerRef = useRef(null);
  const onEndRef = useRef(null);
  const pendingVideoIdRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.YT && window.YT.Player) { initPlayer(); return; }
    window.onYouTubeIframeAPIReady = initPlayer;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);

    function initPlayer() {
      try { playerRef.current = new window.YT.Player('yt-player-container', {
        height: '2', width: '2',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, playsinline: 1, origin: typeof window !== 'undefined' ? window.location.origin : '' },
        events: {
          onReady: () => {
            setYtReady(true);
            // If user tapped a song before iframe finished loading, start it now.
            if (pendingVideoIdRef.current) {
              playerRef.current.loadVideoById(pendingVideoIdRef.current);
              playerRef.current.playVideo();
              pendingVideoIdRef.current = null;
            }
          },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              setDuration(playerRef.current.getDuration());
              startTimer();
            } else if (e.data === window.YT.PlayerState.PAUSED) {
              setIsPlaying(false);
              stopTimer();
            } else if (e.data === window.YT.PlayerState.ENDED) {
              setIsPlaying(false);
              stopTimer();
              if (onEndRef.current) onEndRef.current();
            }
          },
          onError: () => { setIsPlaying(false); stopTimer(); }
        }
      }); } catch(ytInitErr) { console.error('YT player init failed:', ytInitErr); }
    }
    return () => stopTimer();
  }, []);

  function startTimer() {
    stopTimer();
    timerRef.current = setInterval(() => {
      if (playerRef.current?.getCurrentTime) {
        setCurrentTime(playerRef.current.getCurrentTime());
        setDuration(playerRef.current.getDuration());
      }
    }, 500);
  }
  function stopTimer() { if (timerRef.current) clearInterval(timerRef.current); }

  async function searchAndPlay(title, artist) {
    if (!ytReady) return false;
    try {
      const query = `${title} ${artist} official audio`;
      const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.videoId) {
        playerRef.current.loadVideoById(data.videoId);
        playerRef.current.playVideo();
        return true;
      }
      const res2 = await fetch(`/api/youtube-search?q=${encodeURIComponent(title + ' ' + artist + ' song')}`);
      const data2 = await res2.json();
      if (data2.videoId) {
        playerRef.current.loadVideoById(data2.videoId);
        playerRef.current.playVideo();
        return true;
      }
    } catch (e) { console.error('YouTube search failed:', e); }
    return false;
  }

  function play() { playerRef.current?.playVideo(); }
  function pause() { playerRef.current?.pauseVideo(); }
  function playVideoById(vId) {
    if (!vId) return false;
    if (!ytReady || !playerRef.current) {
      pendingVideoIdRef.current = vId;
      return false;
    }
    playerRef.current.loadVideoById(vId);
    playerRef.current.playVideo();
    return true;
  }
  function seekTo(t) { playerRef.current?.seekTo(t, true); }
  function setVolume(v) { playerRef.current?.setVolume(v); }

  return { ytReady, isPlaying, duration, currentTime, searchAndPlay, playVideoById, play, pause, seekTo, setVolume, onEndRef };
}

// ─────────────────────── FORMAT TIME ───────────────────────
function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ─────────────────────── MAIN APP ───────────────────────
export default function Home() {
  const yt = useYouTubePlayer();
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
      if (typeof window !== 'undefined' && canUseNativePlugins() && BackgroundMode) {
        try {
          await BackgroundMode.requestNotificationsPermission();
          await BackgroundMode.enable();
          await BackgroundMode.setSettings({ title: 'Sonix Music', text: 'Playing in background', hidden: false });
          await BackgroundMode.disableWebViewOptimizations();

          const battery = await BackgroundMode.checkBatteryOptimizations();
          if (!battery.enabled) {
            await BackgroundMode.requestDisableBatteryOptimizations();
          }
        } catch(e) { console.error('Background audio permissions error:', e); }
      }
    }
    initNativeBackground();

    const onVisibilityChange = async () => {
      if (!canUseNativePlugins() || !BackgroundMode) return;
      if (!document.hidden) return;
      try {
        await BackgroundMode.enable();
        await BackgroundMode.updateNotification({ title: 'Sonix Music', text: 'Playing in background', hidden: false });
      } catch (e) {
        console.error('Background mode resume error:', e);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    loadPlaylists();
    loadSongs(1);
    backgroundCache();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

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
    searchTimer.current = setTimeout(() => {
      const q = search.toLowerCase();
      const cached = cachedSongs.filter(s =>
        s.title?.toLowerCase().includes(q) ||
        s.artist?.toLowerCase().includes(q) ||
        s.album?.toLowerCase().includes(q)
      ).slice(0, 50);
      setSearchResults(cached);
      setIsSearching(false);
      fetch(`/api/songs?search=${encodeURIComponent(search)}&limit=50`)
        .then(r => r.json())
        .then(d => { if (d.songs?.length > cached.length) setSearchResults(d.songs); })
        .catch(() => {});
    }, 300);
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
  async function playSongDirect(song, songList) {
    if (isLoadingSong) return; // prevent double-clicks
    const key = songKey(song);
    setIsLoadingSong(true);
    setLoadingSongKey(key);

    if (songList) {
      const idx = songList.findIndex(s => (s.songId || s.videoId) === (song.songId || song.videoId));
      queueRef.current = songList;
      queueIndexRef.current = idx >= 0 ? idx : 0;
    }

    try {
      const queueSource = songList || queueRef.current || [];
      if (canPlayNatively(song)) {
        try {
          const nativePayload = buildNativeQueue(queueSource, song);
          if (nativePayload.queue.length > 0) {
            yt.pause();
            await NativeMusicPlayer.playQueue({
              queue: nativePayload.queue,
              index: nativePayload.index,
              shuffle: shuffleEnabled,
              repeatMode,
            });
            queueRef.current = queueSource.length ? queueSource : [song];
            queueIndexRef.current = nativePayload.index;
            setCurrentSong(song);
            setNativeIsPlaying(true);
            return;
          }
        } catch (nativeErr) {
          console.error('Native playback error, using web fallback:', nativeErr);
        }
      }

      const resolvedVideoId = await resolveSongVideoId(song);
      const playableSong = resolvedVideoId && !song.videoId ? { ...song, videoId: resolvedVideoId } : song;

      if (resolvedVideoId) {
        setCurrentSong(playableSong);
        setNativeIsPlaying(false);
        const started = yt.playVideoById(resolvedVideoId);
        // If player isn't ready yet, fallback search can still start playback when ready.
        if (!started && yt.ytReady) {
          await yt.searchAndPlay(song.title, song.artist);
        }
      } else {
        setCurrentSong(song);
        setNativeIsPlaying(false);
        await yt.searchAndPlay(song.title, song.artist);
      }

      prefetchUpcomingVideoIds();
      setIsLoadingSong(false);

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
    if (q.length === 0) return;
    const nextIdx = (queueIndexRef.current + 1) % q.length;
    queueIndexRef.current = nextIdx;
    if (nativeAndroid && canPlayNatively(q[nextIdx])) {
      setCurrentSong(q[nextIdx]);
      setNativeIsPlaying(true);
      NativeMusicPlayer.next().catch((e) => console.error('Native next failed:', e));
      return;
    }
    playSongDirect(q[nextIdx], null); // null = don't reset queue
  }

  function handlePrev() {
    const q = queueRef.current;
    if (q.length === 0) return;
    const prevIdx = queueIndexRef.current <= 0 ? q.length - 1 : queueIndexRef.current - 1;
    queueIndexRef.current = prevIdx;
    if (nativeAndroid && canPlayNatively(q[prevIdx])) {
      setCurrentSong(q[prevIdx]);
      setNativeIsPlaying(true);
      NativeMusicPlayer.previous().catch((e) => console.error('Native previous failed:', e));
      return;
    }
    playSongDirect(q[prevIdx], null);
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
    const usingNativeNow = nativeAndroid && canPlayNatively(currentSong);
    if (usingNativeNow) {
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

  const activePlaying = nativeAndroid && canPlayNatively(currentSong) ? nativeIsPlaying : yt.isPlaying;
  const repeatLabel = repeatMode === 'off' ? '🔁' : repeatMode === 'one' ? '🔂' : '🔁';
  function loadMore() { loadSongs(page + 1, { search, genre, source }); }

  const displaySongs = search.trim() ? searchResults : songs;

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
          <button className="nav-item" onClick={() => { setView('home'); filterGenre(''); }}>
            <span className="icon">🎶</span> All Songs
          </button>
          {['Romance', 'Party', 'Melody', 'Mass', 'Devotional', 'Emotional', 'Folk'].map(g => (
            <button key={g} className={`nav-item ${genre === g ? 'active' : ''}`} onClick={() => filterGenre(g)}>
              <span className="icon">{
                {Romance:'💕',Party:'🎉',Melody:'🎼',Mass:'🔥',Devotional:'🙏',Emotional:'😢',Folk:'🪕'}[g]
              }</span> {g}
            </button>
          ))}

          <div className="nav-section-title">Playlists</div>
          {playlists.map((pl, i) => (
            <button key={i} className={`nav-item ${activePlaylist?.name === pl.name ? 'active' : ''}`} onClick={() => openPlaylist(pl)}>
              <span className="icon">{pl.name.split(' ')[0]}</span> {pl.name.slice(pl.name.indexOf(' ') + 1)}
            </button>
          ))}

          <div className="nav-section-title">Developer Studio</div>
          <button className="nav-item developer-item" onClick={() => document.getElementById('music-upload-input').click()}>
            <span className="icon">🚀</span> <b>Upload & Sync Database</b>
          </button>
          <div className="developer-note">
            Index MP3/CSV metadata directly into the Global Sonix Library.
          </div>

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
                    loadSongs(1); // Refresh list
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

          {(view === 'search' || search.trim()) && (
            <div className="section-header fade-in">
              <h2>{search.trim() ? `Results for "${search}"` : 'Search'}</h2>
              <span style={{ color: '#9ca3af', fontSize: '13px' }}>{searchResults.length} results</span>
            </div>
          )}

          <div className="song-list">
            {displaySongs.map((song, i) => (
              <div
                key={song._id || song.songId || i}
                className={`song-row fade-in ${currentSong?.songId === song.songId ? 'playing' : ''}`}
                style={{ animationDelay: `${Math.min(i * 30, 500)}ms` }}
                onClick={() => playSongDirect(song, displaySongs)}
              >
                <span className="song-num">
                  {loadingSongKey === (song.songId || song._id || song.videoId || `${song.title || ''}::${song.artist || ''}`) ? (
                    <span className="song-loading-spinner" aria-label="Loading song"></span>
                  ) : currentSong?.songId === song.songId ? (
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
                  <div className="song-title">{song.title}</div>
                  <div className="song-artist">{song.artist}</div>
                </div>
                <div className="song-album">{song.album}</div>
                <div className="song-duration">{song.duration ? fmt(song.duration) : '-'}</div>
              </div>
            ))}
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
                <div className="title">{currentSong.title}</div>
                <div className="artist">{currentSong.artist}</div>
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
                  yt.seekTo(pct * yt.duration);
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
                <div className="artwork-container">
                  {currentSong.image ? (
                    <img src={currentSong.image} className={`artwork ${yt.isPlaying ? 'spin' : ''}`} alt="" />
                  ) : (
                    <div className="artwork placeholder">🎵</div>
                  )}
                </div>
              </div>

              <div className="full-player-right">
                <div className="song-meta">
                  <div className="title">{currentSong.title}</div>
                  <div className="artist">{currentSong.artist}</div>
                </div>

                <div className="audio-beats-panel">
                  <div className="panel-title">Audio Beatz Visualizer</div>
                  <div className="visualizer-options">
                    <button className={visualizer === 'waves' ? 'active' : ''} onClick={() => setVisualizer('waves')}>Waves</button>
                    <button className={visualizer === 'bars' ? 'active' : ''} onClick={() => setVisualizer('bars')}>EQ Bars</button>
                    <button className={visualizer === 'pulse' ? 'active' : ''} onClick={() => setVisualizer('pulse')}>Pulse</button>
                  </div>
                  <p className="note">Visualizer syncs with background playback engine.</p>
                </div>

                <div className="progress-container">
                  <div className="time-row">
                    <span>{fmt(yt.currentTime)}</span>
                    <span>{fmt(yt.duration)}</span>
                  </div>
                  <div className="progress-track-lg" onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    yt.seekTo(pct * yt.duration);
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
      {/* Hidden YouTube player mount point - must exist for YT IFrame API */}
      <div
        id="yt-player-container"
        style={{ position: 'fixed', bottom: 0, left: 0, width: '2px', height: '2px', opacity: 0, pointerEvents: 'none', zIndex: -1 }}
        aria-hidden="true"
      />
    </div>
  );
}
