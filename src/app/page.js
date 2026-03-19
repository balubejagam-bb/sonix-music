'use client';

import { useState, useEffect, useRef } from 'react';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useAuth } from '@/lib/authContext';
import AuthModal from '@/components/AuthModal';
import AddToPlaylistMenu from '@/components/AddToPlaylistMenu';

const NativeMusicPlayer = globalThis.__SONIX_NATIVE_MUSIC_PLAYER__ || registerPlugin('MusicPlayer');
if (!globalThis.__SONIX_NATIVE_MUSIC_PLAYER__) {
  globalThis.__SONIX_NATIVE_MUSIC_PLAYER__ = NativeMusicPlayer;
}

if (typeof window !== 'undefined') {
  // Some injected bridge/plugin scripts call triggerEvent eagerly.
  // Ensure a safe no-op exists so startup doesn't break rendering.
  window.Capacitor = window.Capacitor || {};
  if (typeof window.Capacitor.triggerEvent !== 'function') {
    window.Capacitor.triggerEvent = () => {};
  }
  window.Capacitor.Plugins = window.Capacitor.Plugins || {};
  if (!window.Capacitor.Plugins.App || typeof window.Capacitor.Plugins.App.triggerEvent !== 'function') {
    window.Capacitor.Plugins.App = {
      ...(window.Capacitor.Plugins.App || {}),
      triggerEvent: () => {},
    };
  }
}

function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function resolveApiBase() {
  if (isNativeAndroid()) return 'https://sonix-music.vercel.app';
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

function clientApiPath(path) {
  if (typeof path !== 'string') return path;

  // Never allow localhost API URLs in deployed/browser clients.
  const localApiMatch = path.match(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/api\/.*)$/i);
  if (localApiMatch) {
    path = localApiMatch[1];
  }

  // Normalize any absolute API URL to this runtime's API base.
  if (/^https?:\/\//i.test(path)) {
    try {
      const u = new URL(path);
      if (u.pathname.startsWith('/api/')) {
        return `${resolveApiBase()}${u.pathname}${u.search}${u.hash}`;
      }
      return path;
    } catch {
      return path;
    }
  }

  if (!path.startsWith('/')) return path;
  const base = resolveApiBase();
  return base ? `${base}${path}` : path;
}

let backgroundModeLoaderPromise = null;
async function getBackgroundMode() {
  if (typeof window === 'undefined') return null;
  if (!isNativeAndroid()) return null;

  if (!backgroundModeLoaderPromise) {
    backgroundModeLoaderPromise = import('@anuradev/capacitor-background-mode')
      .then((m) => {
        const bg = m?.BackgroundMode;
        if (!bg) return null;

        // Wrap plugin methods in plain functions so this object is never treated
        // as a thenable by await/promise resolution.
        return {
          enable: (...args) => bg.enable?.(...args),
          disableWebViewOptimizations: (...args) => bg.disableWebViewOptimizations?.(...args),
          setDefaults: (...args) => bg.setDefaults?.(...args),
        };
      })
      .catch(() => null);
  }

  return backgroundModeLoaderPromise;
}

function getMusicControls() {
  if (typeof window === 'undefined') return null;
  // On Android we now use the native MusicPlayer plugin/service path.
  // Avoid Cordova MusicControls bootstrap errors that can break initial render.
  if (isNativeAndroid()) return null;
  try {
    const mc = window.MusicControls || null;
    if (mc && typeof mc.subscribe === 'function') return mc;
    return null;
  } catch (e) {
    return null;
  }
}

function canUseNativePlugins() {
  return Capacitor.isNativePlatform();
}

// ─────────────────────── YOUTUBE AUDIO ENGINE ───────────────────────
function useYouTubePlayer() {
  const playerRef       = useRef(null);
  const containerRef    = useRef(null);
  const silentAudioRef  = useRef(null);
  const [ytReady, setYtReady]         = useState(false);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [duration, setDuration]       = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const timerRef        = useRef(null);
  const timerRunning    = useRef(false);
  const onEndRef        = useRef(null);
  const onErrorRef      = useRef(null);
  const pendingVideoIdRef = useRef(null);
  const loadedVideoIdRef  = useRef(null);
  const streamUrlRef      = useRef(null);

  function isValidYouTubeVideoId(vId) {
    return typeof vId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(vId.trim());
  }

  // Stable refs so event handlers inside YT.Player never go stale
  const startTimerRef = useRef(null);
  const stopTimerRef  = useRef(null);

  function startTimer() {
    if (timerRunning.current) return; // already running
    timerRunning.current = true;
    function tick() {
      if (!timerRunning.current) return;
      try {
        if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
          const ct = playerRef.current.getCurrentTime();
          const d  = playerRef.current.getDuration();
          setCurrentTime(ct || 0);
          if (d > 0) setDuration(d);
        }
      } catch {}
      timerRef.current = setTimeout(tick, 250);
    }
    tick();
  }

  function stopTimer() {
    timerRunning.current = false;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }

  // Keep refs up to date so YT event handlers always call the latest version
  startTimerRef.current = startTimer;
  stopTimerRef.current  = stopTimer;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Create silent audio element for background playback
    if (!silentAudioRef.current) {
      try {
        silentAudioRef.current = new Audio();
        // Use the public silence.mp3 if it exists, otherwise base64
        silentAudioRef.current.src = '/silence.mp3'; 
        silentAudioRef.current.loop = true;
        silentAudioRef.current.volume = 0.001; 
        
        // Secondary audio element for direct streams (to bypass YT iframe limitations)
        const a = new Audio();
        a.preload = 'auto';
        a.crossOrigin = 'anonymous';
        a.playsInline = true;
        a.volume = 0.8;
        a.onplay = () => setIsPlaying(true);
        a.onpause = () => setIsPlaying(false);
        a.onended = () => { if (onEndRef.current) onEndRef.current(); };
        a.ontimeupdate = () => {
          setCurrentTime(a.currentTime);
          setDuration(a.duration);
        };
        // @ts-ignore
        playerRef.current_audio = a; 
      } catch (e) {
        console.warn('Media element setup failed:', e);
      }
    }

    function initPlayer() {
      const el = containerRef.current;
      if (!el) return;
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
      try {
        playerRef.current = new window.YT.Player(el, {
          height: '100%', width: '100%',
          playerVars: {
            autoplay: 0, 
            controls: 1, // Enable controls for video mode
            disablekb: 0, 
            fs: 1,
            modestbranding: 1, 
            rel: 0, 
            playsinline: 1,
            origin: window.location.origin,
            iv_load_policy: 3
          },
          events: {
            onReady: () => {
              setYtReady(true);
              if (isValidYouTubeVideoId(pendingVideoIdRef.current)) {
                try {
                  playerRef.current.loadVideoById(pendingVideoIdRef.current);
                  playerRef.current.playVideo();
                  loadedVideoIdRef.current = pendingVideoIdRef.current;
                } catch {}
                pendingVideoIdRef.current = null;
              }
            },
            onStateChange: (e) => {
              const S = window.YT?.PlayerState;
              if (!S) return;
              if (e.data === S.PLAYING) {
                setIsPlaying(true);
                try { setDuration(playerRef.current.getDuration()); } catch {}
                startTimerRef.current();
                // Always play silent audio when YouTube is playing
                if (silentAudioRef.current) {
                  silentAudioRef.current.play().catch(() => {
                    // Fallback: interaction might be needed
                  });
                }
              } else if (e.data === S.PAUSED) {
                // For background playback, we should NOT pause silent audio
                // The silent audio should keep playing to maintain audio context
                setIsPlaying(false);
                stopTimerRef.current();
                // DO NOT pause silent audio - keep it playing for background audio context
                // This helps prevent browser from suspending audio when tab is in background
              } else if (e.data === S.ENDED) {
                setIsPlaying(false);
                stopTimerRef.current();
                // Only pause silent audio when song actually ends (not when tab switches)
                if (silentAudioRef.current) silentAudioRef.current.pause();
                if (onEndRef.current) onEndRef.current();
              } else if (e.data === S.BUFFERING) {
                setIsPlaying(true);
                // Keep silent audio playing during buffering
                if (silentAudioRef.current && silentAudioRef.current.paused) {
                  silentAudioRef.current.play().catch(() => {});
                }
              }
            },
            onError: (e) => {
              console.error('YT player error:', e.data);
              setIsPlaying(false);
              stopTimerRef.current();
              if (typeof onErrorRef.current === 'function') {
                try { onErrorRef.current(e.data); } catch {}
              }
            },
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

    return () => {
      stopTimerRef.current();
      // Clean up silent audio element
      if (silentAudioRef.current) {
        try {
          silentAudioRef.current.pause();
          silentAudioRef.current.src = '';
          silentAudioRef.current = null;
        } catch (e) {
          console.warn('Error cleaning up silent audio:', e);
        }
      }
    };
  }, []);

  function isReady() {
    return !!(playerRef.current && typeof playerRef.current.playVideo === 'function');
  }

  async function searchAndPlay(title, artist, type = 'song') {
    try {
      const q1 = `${title} ${artist} official audio`.trim();
      const r1 = await fetch(clientApiPath(`/api/youtube-search?q=${encodeURIComponent(q1)}`));
      const d1 = await r1.json();
      if (isValidYouTubeVideoId(d1?.videoId)) { playVideoById(d1.videoId); return true; }

      const q2 = `${title} ${artist} song`.trim();
      const r2 = await fetch(clientApiPath(`/api/youtube-search?q=${encodeURIComponent(q2)}`));
      const d2 = await r2.json();
      if (isValidYouTubeVideoId(d2?.videoId)) { playVideoById(d2.videoId); return true; }
    } catch (e) { console.error('YT searchAndPlay failed:', e); }
    return false;
  }

  function play()  { 
    const a = playerRef.current_audio;
    if (a && a.src && a.src !== window.location.href) { a.play().catch(() => {}); return; }
    if (isReady()) { try { playerRef.current.playVideo();  } catch {} } 
  }
  function pause() { 
    const a = playerRef.current_audio;
    if (a) a.pause();
    if (isReady()) { try { playerRef.current.pauseVideo(); } catch {} } 
  }

  function playVideoById(vId) {
    if (!isValidYouTubeVideoId(vId)) return false;
    const videoId = vId.trim();
    
    // Stop direct audio if playing
    const a = playerRef.current_audio;
    if (a) { a.pause(); a.src = ''; }

    if (!isReady()) {
      pendingVideoIdRef.current = videoId;
      return true;
    }
    try {
      playerRef.current.loadVideoById(videoId);
      playerRef.current.playVideo();
      loadedVideoIdRef.current = videoId;
      return true;
    } catch (e) {
      console.error('playVideoById failed:', e);
      return false;
    }
  }

  function playStream(url, fallbackVideoId = null) {
    if (!url) return Promise.resolve(false);
    pause(); // stop YT
    const a = playerRef.current_audio;
    if (a) {
      const currentSrc = a.currentSrc || a.src || '';
      let sameSource = currentSrc === url;
      if (!sameSource) {
        try {
          const normalizedCurrent = new URL(currentSrc, window.location.href).href;
          const normalizedNext = new URL(url, window.location.href).href;
          sameSource = normalizedCurrent === normalizedNext;
        } catch {}
      }
      if (!sameSource) {
        a.src = url;
        try { a.load(); } catch {}
      }
      return a.play().then(() => {
        setIsPlaying(true);
        return true;
      }).catch(e => {
        console.warn('Audio play failed, fallback to YT:', e);
        if (fallbackVideoId && isValidYouTubeVideoId(fallbackVideoId)) {
          try {
            const started = playVideoById(fallbackVideoId);
            if (started) {
              setIsPlaying(true);
              return true;
            }
          } catch {}
        }
        return false;
      });
    }
    if (fallbackVideoId && isValidYouTubeVideoId(fallbackVideoId)) {
      try {
        playVideoById(fallbackVideoId);
        setIsPlaying(true);
        return Promise.resolve(true);
      } catch {}
    }
    return Promise.resolve(false);
  }

  function seekTo(t) {
    const a = playerRef.current_audio;
    if (a && a.src && a.src !== window.location.href) { a.currentTime = t; return; }
    if (isReady()) { try { playerRef.current.seekTo(t, true); } catch {} }
  }
  function setVolume(v) {
    const a = playerRef.current_audio;
    if (a) a.volume = v / 100;
    if (isReady()) { try { playerRef.current.setVolume(v); } catch {} }
  }

  function updateNativeTime(c, d) {
    if (typeof c === 'number' && !isNaN(c)) setCurrentTime(c);
    if (typeof d === 'number' && d > 0)     setDuration(d);
  }

  return {
    containerRef, silentAudioRef,
    ytReady, isPlaying, duration, currentTime,
    loadedVideoIdRef,
    searchAndPlay, playVideoById, playStream, play, pause, seekTo, setVolume,
    onEndRef, onErrorRef, updateNativeTime,
    audioElement: typeof window !== 'undefined' ? playerRef.current_audio : null
  };
}

// ─────────────────────── FORMAT TIME ───────────────────────
function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function normalizeVideoId(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  try {
    if (v.includes('youtube.com') || v.includes('youtu.be')) {
      const u = new URL(v);
      const fromQuery = u.searchParams.get('v');
      if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
      const maybePathId = u.pathname.split('/').filter(Boolean).pop();
      if (maybePathId && /^[A-Za-z0-9_-]{11}$/.test(maybePathId)) return maybePathId;
    }
  } catch {}
  return null;
}

// Decode HTML entities like &quot; &amp; &#39;
function decodeHtml(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => String.fromCharCode(parseInt(grp, 16)))
    .replace(/&middot;/g, '·')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—');
}

// ─────────────────────── MAIN APP ───────────────────────

function GlobalErrorHandler() {
  useEffect(() => {
    const handleGlobalError = (event) => {
      const msg = event.message?.toLowerCase() || '';
      const reason = event.reason?.message?.toLowerCase() || '';
      const stack = (event.error?.stack || event.reason?.stack || '').toLowerCase();
      
      // Suppress harmless chrome extension/service worker errors
      const isExtensionError = 
        msg.includes('could not establish connection') ||
        reason.includes('could not establish connection') ||
        stack.includes('chrome-extension://') ||
        msg.includes('receiving end does not exist') ||
        reason.includes('receiving end does not exist');

      if (isExtensionError) {
        // Silently suppress — don't log
        try {  event.preventDefault?.(); } catch {}
        try { event.stopImmediatePropagation?.(); } catch {}
      }
    };

    // Use { capture: true } to intercept at capture phase before other handlers
    window.addEventListener('error', handleGlobalError, { capture: true, passive: false });
    window.addEventListener('unhandledrejection', handleGlobalError, { capture: true, passive: false });

    return () => {
      window.removeEventListener('error', handleGlobalError, { capture: true, passive: false });
      window.removeEventListener('unhandledrejection', handleGlobalError, { capture: true, passive: false });
    };
  }, []);

  return null;
}
export default function Home() {
  const yt = useYouTubePlayer();
  const { user, loading: authLoading, logout, likedSongs, likedSongObjects, toggleLike, userPlaylists } = useAuth();
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
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [visualizer, setVisualizer] = useState('waves'); // waves, bars, pulse
  const [nativeIsPlaying, setNativeIsPlaying] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off'); // off, all, one
  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  const [homeSectionsReady, setHomeSectionsReady] = useState(false);
  const browseAllRef = useRef(null);
  const contentScrollRef = useRef(null);
  const songsRetryTimerRef = useRef(null);
  const startupSafetyTimerRef = useRef(null);
  const heroTouchStartXRef = useRef(0);

  // Auto-rotate hero every 8 seconds
  useEffect(() => {
    if (view !== 'home' || search.trim()) return;
    const interval = setInterval(() => {
      setActiveHeroIndex(prev => (prev + 1) % Math.min(4, songs.length || 1));
    }, 8000);
    return () => clearInterval(interval);
  }, [view, search, songs.length]);

  // Lazy-render lower home sections to reduce first-paint work on mobile.
  useEffect(() => {
    if (view !== 'home' || search.trim()) return;
    setHomeSectionsReady(false);
    const run = () => setHomeSectionsReady(true);

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 300 });
      return () => window.cancelIdleCallback(id);
    }

    const t = setTimeout(run, 180);
    return () => clearTimeout(t);
  }, [view, search]);
  const [optimisticPlaying, setOptimisticPlaying] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef('');
  const searchTimer = useRef(null);
  const ytResultsCacheRef = useRef(new Map()); // client-side cache: query → ytResults

  // Use refs for queue to avoid stale closures in next/prev
  const queueRef = useRef([]);
  const currentSongRef = useRef(null);
  const queueIndexRef = useRef(0);
  const playRequestIdRef = useRef(0);
  const playStartTimeoutRef = useRef(null);
  const videoIdCacheRef = useRef(new Map());
  const streamUrlCacheRef = useRef(new Map());
  const pendingStreamResolveRef = useRef(new Map());
  const nativeShouldPlayRef = useRef(false);
  const optimisticPlayingRef = useRef(false);
  const nativeLastResumeAtRef = useRef(0);
  const trackSwitchAtRef = useRef(0);
  const pendingVideoIdRef = useRef(new Map());
  const controlsBoundRef = useRef(false);
  const nativeControlsEnabledRef = useRef(true);
  const lastNativeTrackKeyRef = useRef(null);
  const lastNativeActionRef = useRef({ action: '', at: 0 });
  const lastNativeProgressRef = useRef({ time: 0, at: 0 });
  const nativePlaybackSnapshotRef = useRef({ playbackState: 0, playWhenReady: false, updatedAt: 0 });
  const lastWebProgressRef = useRef({ time: 0, at: 0 });
  const lastStallRecoveryRef = useRef({ at: 0, mode: '' });
  const lastStartupRecoveryRef = useRef({ at: 0, key: '', attempts: 0 });
  const nativeTrackLoadedRef = useRef(false);
  const activeEngineRef = useRef('none'); // none | native-audio | web-audio | web-video
  const lastQueueAdvanceRef = useRef({ at: 0, action: '' });
  const queueRecoveryRef = useRef({ timer: null, targetKey: '', attempts: 0 });
  const nativeFailureRef = useRef({
    failures: 0,
    lastFailureAt: 0,
    backoffUntil: 0,
    cooldownUntil: 0,
  });
  const nativeAndroid = isNativeAndroid();

  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  function apiPath(path) {
    return clientApiPath(path);
  }

  function shouldApplyNativeProgress(nextCurrentTime) {
    if (typeof nextCurrentTime !== 'number') return true;
    const withinSwitchWindow = Date.now() - trackSwitchAtRef.current < 1500;
    if (!withinSwitchWindow) return true;
    // Ignore carry-over progress from the previous track during handoff.
    return nextCurrentTime <= 4;
  }

  function updateNativePlaybackSnapshot(res) {
    if (!res || typeof res !== 'object') return;
    nativePlaybackSnapshotRef.current = {
      playbackState:
        typeof res.playbackState === 'number'
          ? res.playbackState
          : nativePlaybackSnapshotRef.current.playbackState,
      playWhenReady:
        typeof res.playWhenReady === 'boolean'
          ? res.playWhenReady
          : nativePlaybackSnapshotRef.current.playWhenReady,
      updatedAt: Date.now(),
    };
  }

  function shouldForceNativeRecovery(now = Date.now()) {
    if (
      !nativeTrackLoadedRef.current ||
      !nativeShouldPlayRef.current ||
      isLoadingSongRef.current ||
      activeEngineRef.current !== 'native-audio'
    ) {
      return false;
    }

    const recentNativeProgress = now - lastNativeProgressRef.current.at < 6500;
    const recentTrackSwitch = now - trackSwitchAtRef.current < 8000;
    const recentResume = now - nativeLastResumeAtRef.current < 8000;
    const nativeSnapshot = nativePlaybackSnapshotRef.current;
    const bufferingOrReady =
      nativeSnapshot.playbackState === 2 || nativeSnapshot.playbackState === 3;
    const waitingForNativeStart =
      bufferingOrReady &&
      (nativeSnapshot.playWhenReady || recentNativeProgress || nativeShouldPlayRef.current);

    if (recentNativeProgress || recentTrackSwitch || recentResume || waitingForNativeStart) {
      return false;
    }

    return true;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nowMs() {
    return Date.now();
  }

  function canAttemptNativePlayback() {
    const now = nowMs();
    const st = nativeFailureRef.current;
    if (st.cooldownUntil > now) return false;
    if (st.backoffUntil > now) return false;
    return true;
  }

  function registerNativeFailure(reason = 'unknown') {
    const now = nowMs();
    const st = nativeFailureRef.current;
    const withinWindow = now - st.lastFailureAt < 120000;
    const failures = withinWindow ? st.failures + 1 : 1;
    const backoffMs = Math.min(1500 * Math.pow(2, Math.max(0, failures - 1)), 20000);
    const cooldownUntil = failures >= 4 ? now + 90000 : st.cooldownUntil;

    nativeFailureRef.current = {
      failures,
      lastFailureAt: now,
      backoffUntil: now + backoffMs,
      cooldownUntil,
    };

    console.warn('[Android] Native playback failure registered', {
      reason,
      failures,
      backoffMs,
      cooldownActive: cooldownUntil > now,
    });
  }

  function registerNativeSuccess() {
    nativeFailureRef.current = {
      failures: 0,
      lastFailureAt: 0,
      backoffUntil: 0,
      cooldownUntil: 0,
    };
  }

  async function enforceEngineLock(targetEngine) {
    if (activeEngineRef.current === targetEngine) return;

    if (targetEngine === 'native-audio') {
      yt.pause();
      activeEngineRef.current = targetEngine;
      return;
    }

    if (nativeAndroid && (nativeTrackLoadedRef.current || nativeIsPlaying || nativeShouldPlayRef.current)) {
      await NativeMusicPlayer.pause().catch(() => {});
    }
    setNativeIsPlaying(false);
    nativeShouldPlayRef.current = false;
    activeEngineRef.current = targetEngine;
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 10000) {
    if (nativeAndroid) {
      const res = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      if (!res || res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res?.status || 0}`);
      }
      if (typeof res.data === 'string') {
        try {
          return JSON.parse(res.data);
        } catch {
          throw new Error('Invalid JSON response');
        }
      }
      return res.data;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function canPlayNatively(song) {
    return nativeAndroid && typeof song?.url === 'string' && /^https?:\/\//i.test(song.url);
  }

  function openAuthModal() {
    setMobileMenuOpen(false);
    setShowAuthModal(true);
  }

  function isLikelyDirectAudioUrl(url = '') {
    if (!/^https?:\/\//i.test(url)) return false;
    return /\.(mp3|m4a|m4b|aac|ogg|flac|wav|mp4)(\?|$)/i.test(url) ||
      /media|cdn|stream|audio|saavncdn|jiosaavn/i.test(url);
  }

  function buildNativeQueue(sourceQueue = [], selectedSong = null, selectedResolvedUrl = '') {
    const seen = new Set();
    const queue = [];
    const selectedKey = selectedSong ? songKey(selectedSong) : null;

    const pushSong = (candidate) => {
      if (!candidate) return;
      const key = songKey(candidate);
      if (seen.has(key)) return;

      let url = '';
      if (selectedKey && key === selectedKey && /^https?:\/\//i.test(selectedResolvedUrl || '')) {
        url = selectedResolvedUrl;
      } else if (typeof candidate.url === 'string' && /^https?:\/\//i.test(candidate.url)) {
        url = candidate.url;
      }

      if (!isLikelyDirectAudioUrl(url)) {
        const cached =
          streamUrlCacheRef.current.get(key) ||
          (typeof window !== 'undefined' ? localStorage.getItem(`sonix_stream_${key}`) : null);
        if (cached && /^https?:\/\//i.test(cached)) {
          url = cached;
        }
      }

      if (!/^https?:\/\//i.test(url)) return;

      queue.push({
        url,
        title: candidate.title || 'Unknown Track',
        artist: candidate.artist || 'Unknown Artist',
        album: candidate.album || 'Sonix Music',
        artwork: candidate.image || candidate.thumbnail || '',
      });
      seen.add(key);
    };

    if (selectedSong) pushSong(selectedSong);
    for (const s of sourceQueue) pushSong(s);

    if (!queue.length && selectedSong && /^https?:\/\//i.test(selectedResolvedUrl || selectedSong.url || '')) {
      return {
        queue: [{
          url: selectedResolvedUrl || selectedSong.url,
          title: selectedSong.title || 'Unknown Track',
          artist: selectedSong.artist || 'Unknown Artist',
          album: selectedSong.album || 'Sonix Music',
          artwork: selectedSong.image || selectedSong.thumbnail || '',
        }],
        index: 0,
      };
    }

    const selectedUrl = selectedResolvedUrl || selectedSong?.url || '';
    const index = Math.max(0, queue.findIndex((s) => s.url === selectedUrl));
    return { queue, index };
  }

  // ───── Load initial data & cache (Once) ─────
  useEffect(() => {
    const initApp = async () => {
      // Hydrate quickly from local cache for lag-free first paint on mobile.
      try {
        const cachedRaw = localStorage.getItem('sonix_cache');
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (Array.isArray(cached) && cached.length) {
            setCachedSongs(cached);
            setSongs(cached.slice(0, nativeAndroid ? 25 : 50));
            setTotalSongs(cached.length);
            setLoading(false);
          }
        }
      } catch {}

      // Never let startup spinner block the UI for too long on slow mobile networks.
      startupSafetyTimerRef.current = setTimeout(() => {
        setLoading(false);
      }, nativeAndroid ? 4500 : 3500);

      // Wake lock is optional; request without blocking the first paint.
      if ('wakeLock' in navigator) {
        navigator.wakeLock?.request?.('screen').catch(() => {});
      }

      // Initialize native plugins in background so home content can render first.
      if (nativeAndroid) {
        setTimeout(async () => {
          try {
            await LocalNotifications.requestPermissions();
            const bg = await getBackgroundMode();
            if (bg) {
              await bg.enable();
              if (typeof bg.disableWebViewOptimizations === 'function') {
                await bg.disableWebViewOptimizations();
              }
              if (typeof bg.setDefaults === 'function') {
                await bg.setDefaults({
                  title: 'Sonix Music',
                  text: 'Running in background',
                  icon: 'icon',
                  color: '7c3aed',
                  resume: true,
                  hidden: false
                });
              }
            }
          } catch(e) { console.error('Background init failed:', e); }
        }, 600);
      }

      loadPlaylists();
      loadSongs(1);
      if (nativeAndroid) {
        setTimeout(() => { backgroundCache(); }, 7000);
      } else {
        backgroundCache();
      }

      try {
        const saved = localStorage.getItem('sonix_recent');
        if (saved) setRecentlyPlayed(JSON.parse(saved));
      } catch {}
    };

    initApp();
    return () => {
      if (startupSafetyTimerRef.current) {
        clearTimeout(startupSafetyTimerRef.current);
        startupSafetyTimerRef.current = null;
      }
    };
  }, []);

  // ───── Playback watchdog (keep background playing) ─────
  useEffect(() => {
    if (nativeAndroid) return;
    if (typeof yt.currentTime !== 'number' || Number.isNaN(yt.currentTime)) return;
    if (yt.currentTime > lastWebProgressRef.current.time + 0.15) {
      lastWebProgressRef.current = { time: yt.currentTime, at: Date.now() };
    }
  }, [yt.currentTime, nativeAndroid]);

  useEffect(() => {
    const handoffToNativeBackground = async () => {
      if (!nativeAndroid || !currentSong || !canUseNativePlugins()) return false;

      // Do not collapse an existing native queue while already on native audio.
      if (
        activeEngineRef.current === 'native-audio' &&
        nativeTrackLoadedRef.current &&
        (nativeIsPlaying || nativeShouldPlayRef.current)
      ) {
        if (!nativeIsPlaying && nativeShouldPlayRef.current) {
          NativeMusicPlayer.resume().catch(() => {});
        }
        return true;
      }

      const resumeAt = yt.currentTime || 0;
      const videoId = currentSong.videoId || await resolveSongVideoId(currentSong);
      if (!videoId) return false;

      const streamUrl = await resolveAudioStreamForSong(currentSong, videoId, { prefetch: true });
      if (!streamUrl) return false;

      const queueSource = queueRef.current?.length ? queueRef.current : [currentSong];
      const selectedSong = { ...currentSong, url: streamUrl, videoId };
      const { queue: nativeQueue, index: nativeIndex } = buildNativeQueue(queueSource, selectedSong, streamUrl);
      if (!nativeQueue.length) return false;

      await NativeMusicPlayer.playQueue({
        queue: nativeQueue,
        index: nativeIndex,
        shuffle: shuffleEnabled,
        repeatMode,
      });

      if (resumeAt > 0) {
        NativeMusicPlayer.seekTo({ positionMs: resumeAt * 1000 }).catch(() => {});
      }

      yt.pause();
      setCurrentSong(prev => prev ? { ...prev, url: streamUrl, videoId } : prev);
      nativeTrackLoadedRef.current = true;
      nativeShouldPlayRef.current = true;
      setOptimisticPlaying(true);
      setNativeIsPlaying(true);
      activeEngineRef.current = 'native-audio';
      return true;
    };

      const handleVisibility = async () => {
        if (document.hidden) {
        console.log('[Sonix] App backgrounded. Ensuring playback stability.');
        const bg = await getBackgroundMode();
        if (bg) bg.enable();

        if (
          nativeAndroid &&
          currentSong &&
          nativeTrackLoadedRef.current &&
          nativeShouldPlayRef.current &&
          !nativeIsPlaying
        ) {
          const now = Date.now();
          if (shouldForceNativeRecovery(now)) {
            nativeLastResumeAtRef.current = now;
            NativeMusicPlayer.resume().catch(() => {});
          }
        }
        
        if (
          nativeAndroid &&
          currentSong &&
          (yt.isPlaying || optimisticPlayingRef.current || activeEngineRef.current !== 'native-audio')
        ) {
          try {
            await handoffToNativeBackground();
          } catch {}
        } else if (
          !nativeAndroid &&
          currentSong &&
          (yt.isPlaying || optimisticPlayingRef.current) &&
          activeEngineRef.current !== 'web-audio'
        ) {
          try {
            if (yt.silentAudioRef.current?.paused) {
              yt.silentAudioRef.current.play().catch(() => {});
            }
            const fallbackVideoId = currentSong.videoId || await resolveSongVideoId(currentSong);
            const streamUrl = await resolveAudioStreamForSong(currentSong, fallbackVideoId, { prefetch: true });
            if (streamUrl) {
              await enforceEngineLock('web-audio');
              const started = await yt.playStream(streamUrl, fallbackVideoId || null);
              if (started) {
                activeEngineRef.current = 'web-audio';
                setOptimisticPlaying(true);
              }
            }
          } catch {}
        }
      } else {
        console.log('[Sonix] App foregrounded. Syncing states.');
        if (
          !nativeAndroid &&
          (optimisticPlaying || yt.isPlaying || nativeIsPlaying) &&
          yt.silentAudioRef.current &&
          yt.silentAudioRef.current.paused
        ) {
          yt.silentAudioRef.current.play().catch(() => {});
        }
      }
    };

    const handleAppState = async ({ isActive }) => {
      if (!nativeAndroid) return;
      if (!isActive) {
        console.log('[Sonix] Native app backgrounded. Ensuring playback stability.');
        const bg = await getBackgroundMode();
        if (bg) bg.enable();

        if (
          currentSong &&
          nativeTrackLoadedRef.current &&
          nativeShouldPlayRef.current &&
          !nativeIsPlaying
        ) {
          const now = Date.now();
          if (shouldForceNativeRecovery(now)) {
            nativeLastResumeAtRef.current = now;
            NativeMusicPlayer.resume().catch(() => {});
          }
        } else if (currentSong) {
          try {
            await handoffToNativeBackground();
          } catch {}
        }
      } else {
        console.log('[Sonix] Native app foregrounded. Syncing states.');
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibility);
    let appStateListener = null;
    let disposed = false;
    if (nativeAndroid) {
      App.addListener('appStateChange', handleAppState)
        .then((listener) => {
          if (disposed) {
            listener.remove().catch(() => {});
          } else {
            appStateListener = listener;
          }
        })
        .catch(() => {});
    }
    
    const watchdog = setInterval(() => {
      // Logic for background persistence
      const shouldBePlaying = nativeAndroid ? nativeShouldPlayRef.current : optimisticPlaying;
      const isActuallyPlaying = nativeAndroid ? nativeIsPlaying : yt.isPlaying;
      const now = Date.now();
      const canRecoverNow = now - lastStallRecoveryRef.current.at > 7000;
      
      if (shouldBePlaying) {
        // 1. Ensure silent track is ALWAYS playing as an anchor (web only)
        if (!nativeAndroid && yt.silentAudioRef.current && yt.silentAudioRef.current.paused) {
          yt.silentAudioRef.current.play().catch(() => {});
        }

        // 2. Re-poke main engine if it dropped
        if (!isActuallyPlaying && currentSong) {
          if (nativeAndroid) {
            if (shouldForceNativeRecovery(now)) {
              nativeLastResumeAtRef.current = now;
              NativeMusicPlayer.resume().catch(() => {});
            }
          } else {
            yt.play();
          }
        }

        // 3. Recover from mid-track stalls where state says playing but progress is stuck.
        if (currentSong && !isLoadingSongRef.current && canRecoverNow) {
          const activeSongKey = songKey(currentSong);

          if (now - trackSwitchAtRef.current > 10000) {
            if (lastStartupRecoveryRef.current.key !== activeSongKey) {
              lastStartupRecoveryRef.current = { at: 0, key: activeSongKey, attempts: 0 };
            }

            if (
              lastStartupRecoveryRef.current.attempts < 2 &&
              now - lastStartupRecoveryRef.current.at > 12000
            ) {
              const nativeStartupStuck =
                nativeAndroid &&
                activeEngineRef.current === 'native-audio' &&
                nativeShouldPlayRef.current &&
                lastNativeProgressRef.current.time <= 0.35 &&
                (lastNativeProgressRef.current.at === 0 || now - lastNativeProgressRef.current.at > 9000);

              const webStartupStuck =
                !nativeAndroid &&
                (activeEngineRef.current === 'web-audio' || activeEngineRef.current === 'web-video') &&
                yt.currentTime <= 0.35 &&
                (lastWebProgressRef.current.at === 0 || now - lastWebProgressRef.current.at > 9000);

              if (nativeStartupStuck || webStartupStuck) {
                lastStartupRecoveryRef.current = {
                  at: now,
                  key: activeSongKey,
                  attempts: lastStartupRecoveryRef.current.attempts + 1,
                };
                lastStallRecoveryRef.current = {
                  at: now,
                  mode: nativeStartupStuck ? 'startup-native' : 'startup-web',
                };
                isLoadingSongRef.current = false;
                playSongDirect(currentSong, queueRef.current?.length ? queueRef.current : null, true);
                return;
              }
            }
          }

          if (nativeAndroid && activeEngineRef.current === 'native-audio' && nativeShouldPlayRef.current) {
            const stalledNative =
              lastNativeProgressRef.current.time > 2 &&
              now - lastNativeProgressRef.current.at > 9000 &&
              nativePlaybackSnapshotRef.current.playbackState !== 2;
            if (stalledNative) {
              lastStallRecoveryRef.current = { at: now, mode: 'native-audio' };
              NativeMusicPlayer.pause()
                .then(() => sleep(180))
                .then(() => NativeMusicPlayer.resume())
                .catch(() => NativeMusicPlayer.resume().catch(() => {}));
            }
          }

          if (!nativeAndroid && (activeEngineRef.current === 'web-audio' || activeEngineRef.current === 'web-video')) {
            const nearEnd = typeof yt.duration === 'number' && yt.duration > 0
              ? yt.duration - yt.currentTime <= 2
              : false;
            const stalledWeb =
              !nearEnd &&
              yt.currentTime > 2 &&
              now - lastWebProgressRef.current.at > 9000;

            if (stalledWeb) {
              lastStallRecoveryRef.current = { at: now, mode: activeEngineRef.current };
              if (activeEngineRef.current === 'web-audio' && yt.audioElement) {
                try { yt.audioElement.pause(); } catch {}
                setTimeout(() => { yt.play(); }, 160);
              } else {
                try { yt.pause(); } catch {}
                setTimeout(() => { yt.play(); }, 160);
              }
            }
          }
        }
      }
    }, 4000);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (appStateListener) {
        appStateListener.remove().catch(() => {});
      }
      clearInterval(watchdog);
    };
  }, [currentSong, nativeIsPlaying, optimisticPlaying, yt.isPlaying]);

  // When user logs in OR cachedSongs loads, sync recently played from server
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('sonix_token');
    if (!token) return;

    fetch(apiPath('/api/user/recent'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        // Use full song objects if server has them
        if (data.songs?.length) {
          setRecentlyPlayed(prev => {
            const serverKeys = new Set(data.songs.map(s => songKey(s)));
            const localOnly = prev.filter(s => !serverKeys.has(songKey(s)));
            const merged = [...data.songs, ...localOnly].slice(0, 20);
            try { localStorage.setItem('sonix_recent', JSON.stringify(merged)); } catch {}
            return merged;
          });
          return;
        }

        // Fallback: match IDs against cachedSongs
        const ids = data.recentlyPlayed || [];
        if (!ids.length || !cachedSongs.length) return;

        const matched = ids
          .map(id => cachedSongs.find(s => {
            const k = s.songId || s._id?.toString() || s.videoId;
            return k && String(k) === String(id);
          }))
          .filter(Boolean);

        if (matched.length > 0) {
          setRecentlyPlayed(prev => {
            const serverKeys = new Set(matched.map(s => songKey(s)));
            const localOnly = prev.filter(s => !serverKeys.has(songKey(s)));
            const merged = [...matched, ...localOnly].slice(0, 20);
            try { localStorage.setItem('sonix_recent', JSON.stringify(merged)); } catch {}
            return merged;
          });
        }
      })
      .catch(() => {});
  }, [user, cachedSongs]);

  // Listen to native player for progress updates and web actions
  useEffect(() => {
    if (nativeAndroid) {
      const stateListener = NativeMusicPlayer.addListener('onStateChanged', (res) => {
        if (res) {
          updateNativePlaybackSnapshot(res);
          // Native state events can be partial; do not force-reset timer to 0.
          const nextCurrentTime = typeof res.currentTime === 'number' && !Number.isNaN(res.currentTime)
            ? res.currentTime
            : undefined;
          const nextDuration = typeof res.duration === 'number' && res.duration > 0
            ? res.duration
            : undefined;
          if (shouldApplyNativeProgress(nextCurrentTime)) {
            yt.updateNativeTime(nextCurrentTime, nextDuration);
            if (
              typeof nextCurrentTime === 'number' &&
              nextCurrentTime > lastNativeProgressRef.current.time + 0.15
            ) {
              lastNativeProgressRef.current = { time: nextCurrentTime, at: Date.now() };
            }
          }

          if (typeof res.isPlaying === 'boolean') {
            const shouldKeepPlayingUi = nativeShouldPlayRef.current || optimisticPlayingRef.current;
            const recentNativeProgress = Date.now() - lastNativeProgressRef.current.at < 4000;
            const nativeReadyState =
              (res.playbackState === 2 || res.playbackState === 3) &&
              (shouldKeepPlayingUi || res.playWhenReady || recentNativeProgress);
            const nativeLooksLoaded =
              !!res.isPlaying ||
              !!res.playWhenReady ||
              recentNativeProgress ||
              (typeof res.duration === 'number' && res.duration > 0);

            // STATE_BUFFERING = 2, keep controls in playing state while startup/buffer happens.
            if (nativeReadyState) {
              activeEngineRef.current = 'native-audio';
              nativeTrackLoadedRef.current = true;
              nativeShouldPlayRef.current = true;
              setNativeIsPlaying(true);
              setOptimisticPlaying(true);
            } else if (res.isPlaying) {
              activeEngineRef.current = 'native-audio';
              nativeTrackLoadedRef.current = true;
              nativeShouldPlayRef.current = true;
              setNativeIsPlaying(true);
              setOptimisticPlaying(true);
            } else {
              if (nativeLooksLoaded) {
                activeEngineRef.current = 'native-audio';
                nativeTrackLoadedRef.current = true;
              }
              setNativeIsPlaying(false);
              if (!nativeShouldPlayRef.current || res.playbackState === 4) {
                setOptimisticPlaying(false);
              }
            }
          }

          // STATE_ENDED = 4; guard against false positives from transient states.
          if (
            res.playbackState === 4 &&
            typeof res.duration === 'number' &&
            typeof res.currentTime === 'number' &&
            res.duration > 0 &&
            res.currentTime >= Math.max(0, res.duration - 1)
          ) {
            // Native Android audio completion is bridged by the service via onWebAction("next").
            // Avoid firing a second local next from JS and skipping tracks.
            if (!(nativeAndroid && activeEngineRef.current === 'native-audio')) {
              handleNext();
            }
          }
        }
      });

      const actionListener = NativeMusicPlayer.addListener('onWebAction', (res) => {
        const action = res?.action;
        if (!action) return;

        // Avoid play/pause feedback loops from rapid duplicate native actions.
        const now = Date.now();
        if (
          lastNativeActionRef.current.action === action &&
          now - lastNativeActionRef.current.at < 700
        ) {
          return;
        }
        lastNativeActionRef.current = { action, at: now };

        if (action === 'next') {
          handleNext();
        } else if (action === 'previous') {
          handlePrev();
        } else if (action === 'play' && nativeTrackLoadedRef.current && activeEngineRef.current === 'native-audio') {
          setNativeIsPlaying(true);
          setOptimisticPlaying(true);
          nativeShouldPlayRef.current = true;
          NativeMusicPlayer.resume().catch(() => {});
        } else if (action === 'pause' && nativeTrackLoadedRef.current && activeEngineRef.current === 'native-audio') {
          setNativeIsPlaying(false);
          setOptimisticPlaying(false);
          nativeShouldPlayRef.current = false;
          NativeMusicPlayer.pause().catch(() => {});
        } else if (action === 'play') {
          setOptimisticPlaying(true);
          if (activeEngineRef.current === 'web-video' && currentSong?.videoId) {
            yt.playVideoById(currentSong.videoId);
          } else {
            yt.play();
          }
        } else if (action === 'pause') {
          setOptimisticPlaying(false);
          yt.pause();
        }
      });

      // Fallback polling (less frequent)
      const timer = setInterval(async () => {
        try {
          const res = await NativeMusicPlayer.getPosition();
          if (res && res.currentTime !== undefined) {
             updateNativePlaybackSnapshot(res);
             const nextCurrentTime = typeof res.currentTime === 'number' && !Number.isNaN(res.currentTime)
               ? res.currentTime
               : undefined;
             const nextDuration = typeof res.duration === 'number' && res.duration > 0
               ? res.duration
               : undefined;
             if (shouldApplyNativeProgress(nextCurrentTime)) {
               yt.updateNativeTime(nextCurrentTime, nextDuration);
               if (
                 typeof nextCurrentTime === 'number' &&
                 nextCurrentTime > lastNativeProgressRef.current.time + 0.15
               ) {
                 lastNativeProgressRef.current = { time: nextCurrentTime, at: Date.now() };
               }
             }
             if (typeof res.isPlaying === 'boolean') {
               const recentNativeProgress = Date.now() - lastNativeProgressRef.current.at < 4000;
               const nativeReadyState =
                 (res.playbackState === 2 || res.playbackState === 3) &&
                 (
                   optimisticPlayingRef.current ||
                   nativeShouldPlayRef.current ||
                   res.playWhenReady ||
                   recentNativeProgress
                 );
               const nativeLooksLoaded =
                 !!res.isPlaying ||
                 !!res.playWhenReady ||
                 recentNativeProgress ||
                 (typeof res.duration === 'number' && res.duration > 0);
               if (nativeReadyState) {
                 activeEngineRef.current = 'native-audio';
                 nativeTrackLoadedRef.current = true;
                 nativeShouldPlayRef.current = true;
                 setNativeIsPlaying(true);
                 setOptimisticPlaying(true);
               } else if (res.isPlaying) {
                 activeEngineRef.current = 'native-audio';
                 nativeTrackLoadedRef.current = true;
                 nativeShouldPlayRef.current = true;
                 setNativeIsPlaying(true);
                 setOptimisticPlaying(true);
               } else {
                 if (nativeLooksLoaded) {
                   activeEngineRef.current = 'native-audio';
                   nativeTrackLoadedRef.current = true;
                 }
                 setNativeIsPlaying(false);
                 if (!nativeShouldPlayRef.current || res.playbackState === 4) {
                   setOptimisticPlaying(false);
                 }
               }
             }
            }
          } catch (e) {}
        }, 2500);

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
        const res = await fetch(apiPath(url), { signal: controller.signal });
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
      const res = await fetch(apiPath('/api/playlists'));
      const data = await res.json();
      setPlaylists(data.playlists || []);
    } catch (e) { console.error('Failed to load playlists', e); }
  }

  async function loadSongs(p, options = {}, attempt = 0) {
    const hasAnyLocal = songs.length > 0 || cachedSongs.length > 0;
    const shouldShowSpinner = p === 1 && !hasAnyLocal && attempt === 0;
    if (shouldShowSpinner) setLoading(true);
    try {
      const pageSize = nativeAndroid ? 25 : 50;
      const requestTimeoutMs = nativeAndroid ? 20000 : 12000;
      const params = new URLSearchParams({
        page: p, limit: pageSize,
        ...(options.search && { search: options.search }),
        ...(options.genre && { genre: options.genre }),
        ...(options.source && options.source !== 'all' && { source: options.source }),
      });
      const data = await fetchJsonWithTimeout(apiPath(`/api/songs?${params}`), requestTimeoutMs);
      if (p === 1) { setSongs(data.songs || []); }
      else { setSongs(prev => [...prev, ...(data.songs || [])]); }
      setTotalSongs(data.total || 0);
      setPage(p);
      if (songsRetryTimerRef.current) {
        clearTimeout(songsRetryTimerRef.current);
        songsRetryTimerRef.current = null;
      }
      if (startupSafetyTimerRef.current) {
        clearTimeout(startupSafetyTimerRef.current);
        startupSafetyTimerRef.current = null;
      }
    } catch (e) { 
      if (e?.name === 'AbortError') {
        console.warn('Songs request timed out, retrying...', { attempt, nativeAndroid });
      } else {
        console.error('Failed to load songs:', e);
      }

      if (nativeAndroid && p === 1 && attempt < 3) {
        const delay = 1000 + (attempt * 700);
        songsRetryTimerRef.current = setTimeout(() => {
          loadSongs(1, options, attempt + 1);
        }, delay);
      } else if (p === 1 && songs.length === 0) {
        setSongs([]); // Clear only when nothing local is available
      }
    }
    setLoading(false);
  }

  function songKey(song) {
    return song.songId || song._id || song.videoId || `${song.title || ''}::${song.artist || ''}`;
  }

  function isLikelyImageUrl(url = '') {
    if (typeof url !== 'string') return false;
    return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url);
  }

  async function resolveSongVideoId(song) {
    if (!song) return null;
    const key = songKey(song);

    const direct = normalizeVideoId(song.videoId);
    if (direct) {
      videoIdCacheRef.current.set(key, direct);
      return direct;
    }

    const cachedVideoId = videoIdCacheRef.current.get(key);
    if (normalizeVideoId(cachedVideoId)) {
      return normalizeVideoId(cachedVideoId);
    }

    // Check localStorage cache for cross-session persistence
    try {
      const persisted = localStorage.getItem(`yt_vid_${key}`);
      const persistedId = normalizeVideoId(persisted);
      if (persistedId) {
        videoIdCacheRef.current.set(key, persistedId);
        return persistedId;
      }
    } catch {}

    if (pendingVideoIdRef.current.has(key)) {
      return pendingVideoIdRef.current.get(key);
    }

    const query = `${song.title || ''} ${song.artist || ''} official audio`.trim();
    const task = searchYouTubeFallback(query)
      .then(data => {
        const candidate = normalizeVideoId(data?.videoId);
        if (candidate) {
          videoIdCacheRef.current.set(key, candidate);
          try { localStorage.setItem(`yt_vid_${key}`, candidate); } catch {}
          return candidate;
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
      // On Android: also warm the stream cache
      const nextVideoId = normalizeVideoId(nextSong.videoId);
      if (nativeAndroid && nextVideoId) {
        fetch(apiPath(`/api/yt-stream?videoId=${encodeURIComponent(nextVideoId)}`)).catch(() => {});
      }
      resolveSongVideoId(nextSong).catch(() => {});

      // Warm resolved stream URLs for faster next/prev switching.
      // Keep this shallow to avoid aggressive network churn on mobile.
      if (step <= 2) {
        const key = songKey(nextSong);
        const cached = streamUrlCacheRef.current.get(key) || localStorage.getItem(`sonix_stream_${key}`);
        if (!cached) {
          resolveAudioStreamForSong(nextSong, nextVideoId || null, { prefetch: true }).catch(() => {});
        }
      }
    }
  }

  async function backgroundCache() {
    try {
      const requestTimeoutMs = nativeAndroid ? 9000 : 7000;
      const cacheLimit = nativeAndroid ? 500 : 1200;
      const data = await fetchJsonWithTimeout(apiPath(`/api/songs?page=1&limit=${cacheLimit}`), requestTimeoutMs);
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
    if (!search.trim()) { setSearchResults([]); setYtResults([]); setIsSearching(false); setIsSearchingYT(false); return; }

    setIsSearching(true);

    // Show cached YT results instantly if available
    const cachedYT = ytResultsCacheRef.current.get(search.trim().toLowerCase());
    if (cachedYT?.length) { setYtResults(cachedYT); setIsSearchingYT(false); }
    else setIsSearchingYT(true);

    searchTimer.current = setTimeout(async () => {
      const q = search.trim();
      const qKey = q.toLowerCase();

      // Instant local filter
      const localQ = qKey;
      const localHits = cachedSongs.filter(s =>
        s.title?.toLowerCase().includes(localQ) ||
        s.artist?.toLowerCase().includes(localQ) ||
        s.album?.toLowerCase().includes(localQ)
      ).slice(0, 30);
      setSearchResults(localHits);

      // DB + YT in parallel
      const dbPromise = fetch(apiPath(`/api/search?q=${encodeURIComponent(q)}`))
        .then(r => r.json())
        .catch(() => null);

      const ytPromise = searchYouTubeFallback(q, true)
        .then(d => Array.isArray(d) ? d : (d?.results || []))
        .catch(() => []);

      // DB results
      dbPromise.then(data => {
        if (!data) return;
        if (data.songs?.length) setSearchResults(data.songs);
        else if (localHits.length === 0) setSearchResults([]);
        if (data.ytResults?.length) {
          setYtResults(data.ytResults);
          ytResultsCacheRef.current.set(qKey, data.ytResults);
          setIsSearchingYT(false);
        }
      }).catch(() => {});

      // YT results — update when they arrive, retry once if empty
      ytPromise.then(async arr => {
        if (arr.length) {
          setYtResults(arr);
          ytResultsCacheRef.current.set(qKey, arr);
          setIsSearchingYT(false);
        } else if (!ytResultsCacheRef.current.get(qKey)?.length) {
          // Retry once with a slightly different query
          try {
            const retry = await searchYouTubeFallback(`${q} song`, true);
            const retryArr = Array.isArray(retry) ? retry : (retry?.results || []);
            if (retryArr.length) {
              setYtResults(retryArr);
              ytResultsCacheRef.current.set(qKey, retryArr);
            }
          } catch {}
          setIsSearchingYT(false);
        }
      }).catch(() => setIsSearchingYT(false));

      await Promise.allSettled([dbPromise, ytPromise]);
      setIsSearching(false);
    }, 350);
  }, [search, cachedSongs]);

  async function searchGlobalYT() {
    if (!search.trim()) return;
    setIsSearchingYT(true);
    try {
      const arr = await searchYouTubeFallback(search, true);
      const results = Array.isArray(arr) ? arr : (arr?.results || []);
      if (results.length) setYtResults(results);
    } catch(e) { console.error('YT Global search failed', e); }
    setIsSearchingYT(false);
  }

  // ───── Voice Search ─────
  function startVoiceSearch() {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice search is not supported on this browser. Try Chrome or Edge.');
      return;
    }

    // Toggle off if already listening
    if (isListening) {
      try { recognitionRef.current?.stop(); } catch {}
      return;
    }

    // Clean up any previous instance
    try { recognitionRef.current?.abort(); } catch {}

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 3;
    recognitionRef.current = recognition;
    finalTranscriptRef.current = '';

    setVoiceTranscript('');
    setIsListening(true);

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        const [topAlternative] = result;
        const transcript = topAlternative?.transcript || '';
        if (result.isFinal) final += transcript;
        else interim += transcript;
      }
      const best = (final || interim).trim();
      if (best) {
        finalTranscriptRef.current = best;
        setVoiceTranscript(best);
      }
    };

    recognition.onerror = (e) => {
      setIsListening(false);
      setVoiceTranscript('');
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        alert('Microphone access denied. Please allow mic permission in your browser settings.');
        return;
      }
      // For no-speech or other errors, still fire search if we captured anything
      const result = finalTranscriptRef.current;
      finalTranscriptRef.current = '';
      if (result) {
        setTimeout(() => { setSearch(result); setView('search'); }, 50);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setVoiceTranscript('');
      const result = finalTranscriptRef.current;
      finalTranscriptRef.current = '';
      if (result) {
        setTimeout(() => { setSearch(result); setView('search'); }, 50);
      }
    };

    try {
      recognition.start();
    } catch (e) {
      setIsListening(false);
      console.error('Voice recognition start failed:', e);
    }
  }

  // ───── Play song (core function) ─────
  async function playSongDirect(song, songList, force = false) {
    // Use ref-based guard so next/prev can always bypass
    if (isLoadingSongRef.current && !force) return;
    isLoadingSongRef.current = true;
    const requestId = ++playRequestIdRef.current;
    const isStale = () => requestId !== playRequestIdRef.current;

    const key = songKey(song);
    const previousKey = currentSong ? songKey(currentSong) : null;
    if (previousKey !== key) {
      trackSwitchAtRef.current = Date.now();
      lastStartupRecoveryRef.current = { at: 0, key, attempts: 0 };
    }
    setIsLoadingSong(true);
    setLoadingSongKey(key);

    // Reset progress immediately when switching tracks to prevent old-time flicker.
    const initialDuration = Math.max(0, Number(song?.duration || 0));
    yt.updateNativeTime(0, initialDuration > 0 ? initialDuration : undefined);
    setOptimisticPlaying(true);

    if (playStartTimeoutRef.current) {
      clearTimeout(playStartTimeoutRef.current);
      playStartTimeoutRef.current = null;
    }
    playStartTimeoutRef.current = setTimeout(() => {
      if (playRequestIdRef.current !== requestId) return;
      isLoadingSongRef.current = false;
      setIsLoadingSong(false);
      setLoadingSongKey(null);
    }, nativeAndroid ? 12000 : 12000);

    if (songList) {
      const idx = songList.findIndex(s => songKey(s) === key);
      queueRef.current = songList;
      queueIndexRef.current = idx >= 0 ? idx : 0;
    }

    let forceWebFallback = false;
    let androidFallbackSong = song;

    try {
      // On Android: use native ExoPlayer only for Audio mode.
      // Keep Video mode on web/YT path so users can use video playback intentionally.
      if (nativeAndroid && !videoEnabled && canUseNativePlugins()) {
        if (!canAttemptNativePlayback()) {
          forceWebFallback = true;
        }

        try {
          const nativeStreamTimeoutMs = 10000;
          const nativeLookupTimeoutMs = 7000;
          let streamUrl = null;
          let videoId = normalizeVideoId(song.videoId);

          if (forceWebFallback) {
            console.warn('[Android] Native playback skipped due to active backoff/cooldown policy.');
            throw new Error('native_backoff_active');
          }

          // Fast path 0: reuse resolved stream from in-memory/local cache
          const cachedStream = streamUrlCacheRef.current.get(key) || localStorage.getItem(`sonix_stream_${key}`);
          if (cachedStream && /^https?:\/\//i.test(cachedStream)) {
            streamUrl = cachedStream;
          }

          // Fast path 1: play direct audio URLs immediately (true Exo behavior)
          if (!streamUrl && isLikelyDirectAudioUrl(song.url || '')) {
            streamUrl = song.url;
          }

          // Path 1: YT song — resolve videoId first if needed, then get stream
          if (!streamUrl) {
            // Resolve videoId if we don't have one yet
            if (!videoId) {
              const query = `${song.title || ''} ${song.artist || ''} official audio`.trim();
              try {
                const data = await fetchJsonWithTimeout(apiPath(`/api/youtube-search?q=${encodeURIComponent(query)}`), nativeLookupTimeoutMs);
                if (isStale()) return;
                if (data.videoId) videoId = normalizeVideoId(data.videoId) || videoId;
              } catch {}
            }

            // Now resolve stream URL from videoId via dedicated route
            if (videoId) {
              try {
                const data = await fetchJsonWithTimeout(apiPath(`/api/yt-stream?videoId=${encodeURIComponent(videoId)}`), nativeStreamTimeoutMs);
                if (isStale()) return;
                if (data.streamUrl) streamUrl = data.streamUrl;
              } catch {}
            }

            // Fallback search+stream path
            if (!streamUrl && videoId) {
              try {
                const data = await fetchJsonWithTimeout(
                  apiPath(`/api/youtube-search?q=${encodeURIComponent((song.title || '') + ' ' + (song.artist || ''))}&stream=true`),
                  nativeLookupTimeoutMs
                );
                if (isStale()) return;
                if (data.videoId) videoId = normalizeVideoId(data.videoId) || videoId;
                if (data.streamUrl) streamUrl = data.streamUrl;
              } catch {}
            }
          }

          // Path 2: resolve page URLs/non-direct links only when YT stream path did not return quickly
          if (!streamUrl && song.url && /^https?:\/\//i.test(song.url)) {
            const streamParams = new URLSearchParams();
            streamParams.set('url', song.url);
            streamParams.set('title', song.title || '');
            streamParams.set('artist', song.artist || '');
            streamParams.set('type', 'song');
            streamParams.set('source', song.source || 'songs');
            const data = await fetchJsonWithTimeout(
              apiPath(`/api/stream?${streamParams.toString()}`),
              nativeStreamTimeoutMs
            );
            if (isStale()) return;
            if (data.streamUrl) streamUrl = data.streamUrl;
            if (data.videoId) {
              const canonicalVideoId = normalizeVideoId(data.videoId);
              if (canonicalVideoId) {
                videoId = canonicalVideoId;
                videoIdCacheRef.current.set(key, canonicalVideoId);
                try { localStorage.setItem(`yt_vid_${key}`, canonicalVideoId); } catch {}
              }
            }
          }

          if (streamUrl) {
            if (isStale()) return;
            streamUrlCacheRef.current.set(key, streamUrl);
            try { localStorage.setItem(`sonix_stream_${key}`, streamUrl); } catch {}

            const artwork = song.thumbnail || song.image || 'https://picsum.photos/seed/sonixart/200';
            const songWithUrl = { ...song, url: streamUrl, videoId: videoId || song.videoId };
            const queueSource = songList || queueRef.current || [];
            const selectedKey = songKey(songWithUrl);
            const nativePlayable = [];
            const nativeSeen = new Set();

            const pushPlayable = (candidate) => {
              if (!candidate) return;
              const cKey = songKey(candidate);
              if (nativeSeen.has(cKey)) return;

              let cUrl = candidate.url || '';
              if (!isLikelyDirectAudioUrl(cUrl)) {
                const cached = streamUrlCacheRef.current.get(cKey) || localStorage.getItem(`sonix_stream_${cKey}`);
                if (cached && /^https?:\/\//i.test(cached)) cUrl = cached;
              }
              if (!cUrl || !/^https?:\/\//i.test(cUrl)) return;

              nativePlayable.push({
                url: cUrl,
                title: candidate.title || 'Unknown Track',
                artist: candidate.artist || 'Unknown Artist',
                album: candidate.album || 'Sonix Music',
                artwork: candidate.thumbnail || candidate.image || 'https://picsum.photos/seed/sonixart/200',
                __key: cKey,
              });
              nativeSeen.add(cKey);
            };

            // Ensure selected track is first added with the freshly resolved stream.
            pushPlayable(songWithUrl);
            for (const item of queueSource) {
              pushPlayable(item);
            }

            const resolvedIndex = Math.max(0, nativePlayable.findIndex(item => item.__key === selectedKey));
            const androidQueue = nativePlayable.map(({ __key, ...rest }) => rest);

            yt.pause();
            await enforceEngineLock('native-audio');
            await NativeMusicPlayer.playQueue({
              queue: androidQueue,
              index: resolvedIndex,
              shuffle: shuffleEnabled,
              repeatMode,
            });
            if (isStale()) return;

            // Optimistically mark native playback started to reduce first-play delay.
            registerNativeSuccess();
            queueRef.current = queueSource.length ? queueSource : [songWithUrl];
            queueIndexRef.current = Math.max(0, queueSource.findIndex(s => songKey(s) === key));
            setCurrentSong(songWithUrl);
            setNativeIsPlaying(true);
            nativeTrackLoadedRef.current = true;
            nativeShouldPlayRef.current = true;
            activeEngineRef.current = 'native-audio';
            isLoadingSongRef.current = false;
            setIsLoadingSong(false);
            setLoadingSongKey(null);
            prefetchUpcomingVideoIds();
            // Native queue accepted: rely on plugin/player state updates and watchdog recovery.
            // Avoid immediate false-negative fallback loops that can lock UI in loading state.
            return;
          }

          // Stream resolution failed — fall back to web/YT playback path.
          console.warn('[Android] Native stream resolution failed for ExoPlayer:', song.title);
          registerNativeFailure('stream_resolution_failed');
          androidFallbackSong = { ...song, videoId: videoId || song.videoId || null };
          setCurrentSong(androidFallbackSong);
          setNativeIsPlaying(false);
          nativeTrackLoadedRef.current = false;
          nativeShouldPlayRef.current = false;
          isLoadingSongRef.current = false;
          forceWebFallback = true;
          await NativeMusicPlayer.pause().catch(() => {});
          setIsLoadingSong(true);
          setLoadingSongKey(key);

        } catch (nativeErr) {
          console.error('Native playback error:', nativeErr);
          registerNativeFailure(nativeErr?.message || 'native_exception');
          nativeTrackLoadedRef.current = false;
          nativeShouldPlayRef.current = false;
          setNativeIsPlaying(false);
          isLoadingSongRef.current = false;
          forceWebFallback = true;
          await NativeMusicPlayer.pause().catch(() => {});
          setIsLoadingSong(true);
          setLoadingSongKey(key);
        }
      }

      // Web path (browser / non-Android)
      const songForWeb = forceWebFallback ? androidFallbackSong : song;
      const resolvedVideoId = await resolveSongVideoId(songForWeb);
      if (isStale()) return;
      const playableSong = (resolvedVideoId && !songForWeb.videoId)
        ? { ...songForWeb, videoId: resolvedVideoId }
        : songForWeb;

      const vId = normalizeVideoId(playableSong.videoId) || resolvedVideoId;
      setCurrentSong(playableSong);
      setNativeIsPlaying(false);
      nativeTrackLoadedRef.current = false;
      nativeShouldPlayRef.current = false;

      // On Android, when native audio fails, keep audio-first fallback.
      // Try web audio stream before switching to video mode.
      if (nativeAndroid && forceWebFallback && vId) {
        const streamUrl = await resolveAudioStreamForSong(playableSong, vId);
        if (isStale()) return;

        if (streamUrl) {
          await enforceEngineLock('web-audio');
          const started = await yt.playStream(streamUrl, vId);
          if (started) {
            activeEngineRef.current = 'web-audio';
            isLoadingSongRef.current = false;
            setIsLoadingSong(false);
            setLoadingSongKey(null);

            setRecentlyPlayed(prev => {
              const filtered = prev.filter(s => songKey(s) !== songKey(playableSong));
              const next = [playableSong, ...filtered].slice(0, 20);
              try { localStorage.setItem('sonix_recent', JSON.stringify(next)); } catch {}
              return next;
            });

            prefetchUpcomingVideoIds();
            return;
          }
        }

        // Last-resort fallback: video mode.
        await enforceEngineLock('web-video');
        const started = yt.playVideoById(vId);
        if (!started) {
          await yt.searchAndPlay(playableSong.title || '', playableSong.artist || '', playableSong.type || 'song');
        }
        activeEngineRef.current = 'web-video';
        isLoadingSongRef.current = false;
        setIsLoadingSong(false);
        setLoadingSongKey(null);

        setRecentlyPlayed(prev => {
          const filtered = prev.filter(s => songKey(s) !== songKey(playableSong));
          const next = [playableSong, ...filtered].slice(0, 20);
          try { localStorage.setItem('sonix_recent', JSON.stringify(next)); } catch {}
          return next;
        });

        prefetchUpcomingVideoIds();
        return;
      }
      
      // Audio-first UX: only load iframe video when user explicitly chooses Video mode.
      if (vId) {
        if (videoEnabled) {
          await enforceEngineLock('web-video');
          yt.playVideoById(vId);
          activeEngineRef.current = 'web-video';
        } else {
          const streamUrl = await resolveAudioStreamForSong(playableSong, vId);
          if (isStale()) return;
          if (streamUrl) {
            await enforceEngineLock('web-audio');
            const started = await yt.playStream(streamUrl, vId);
            if (started) {
              activeEngineRef.current = yt.loadedVideoIdRef.current === vId ? 'web-video' : 'web-audio';
            } else {
              if (vId) {
                await enforceEngineLock('web-video');
                yt.playVideoById(vId);
                activeEngineRef.current = 'web-video';
              } else {
                setOptimisticPlaying(false);
                isLoadingSongRef.current = false;
                setIsLoadingSong(false);
                setLoadingSongKey(null);
                return;
              }
            }
          } else {
            await enforceEngineLock('web-video');
            yt.playVideoById(vId);
            activeEngineRef.current = 'web-video';
          }
        }
      } else {
        const fallbackVideoId = await resolveSongVideoId(playableSong);
        if (isStale()) return;
        if (fallbackVideoId) {
          const nextSong = { ...playableSong, videoId: fallbackVideoId };
          setCurrentSong(nextSong);
          const streamUrl = await resolveAudioStreamForSong(nextSong, fallbackVideoId);
          if (isStale()) return;
          if (streamUrl) {
            await enforceEngineLock('web-audio');
            const started = await yt.playStream(streamUrl, fallbackVideoId);
            if (started) {
              activeEngineRef.current = yt.loadedVideoIdRef.current === fallbackVideoId ? 'web-video' : 'web-audio';
            } else {
              await enforceEngineLock('web-video');
              yt.playVideoById(fallbackVideoId);
              activeEngineRef.current = 'web-video';
            }
          }
          else {
            await enforceEngineLock('web-video');
            yt.playVideoById(fallbackVideoId);
            activeEngineRef.current = 'web-video';
          }
        } else {
          setOptimisticPlaying(false);
          isLoadingSongRef.current = false;
          setIsLoadingSong(false);
          setLoadingSongKey(null);
          return;
        }
      }

      isLoadingSongRef.current = false;
      setIsLoadingSong(false);
      setLoadingSongKey(null);

      // Track recently played (local + persisted)
      setRecentlyPlayed(prev => {
        const filtered = prev.filter(s => songKey(s) !== songKey(playableSong));
        const next = [playableSong, ...filtered].slice(0, 20);
        try { localStorage.setItem('sonix_recent', JSON.stringify(next)); } catch {}
        return next;
      });

      // Track on server if logged in — send full song object
      const token = typeof window !== 'undefined' ? localStorage.getItem('sonix_token') : null;
      if (token) {
        const sid = encodeURIComponent(songKey(playableSong));
        fetch(apiPath(`/api/user/recent/${sid}`), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(playableSong),
        }).catch(() => {});
      }

      prefetchUpcomingVideoIds();

      if ('mediaSession' in navigator) {
        const artwork = playableSong.thumbnail ||
          playableSong.image ||
          (playableSong.videoId ? `https://img.youtube.com/vi/${playableSong.videoId}/hqdefault.jpg` : 'https://picsum.photos/seed/sonix/200');

        navigator.mediaSession.metadata = new MediaMetadata({
          title: playableSong.title || 'Unknown Track',
          artist: playableSong.artist || 'Unknown Artist',
          album: playableSong.album || 'Sonix Music',
          artwork: [
            { src: artwork.replace('mqdefault', 'hqdefault').replace('sddefault', 'hqdefault'), sizes: '480x360', type: 'image/jpeg' },
            { src: artwork, sizes: '320x180', type: 'image/jpeg' },
          ],
        });
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.setActionHandler('play', () => {
          const uiPlayingState = nativeAndroid && !videoEnabled
            ? (nativeIsPlaying || nativeShouldPlayRef.current || optimisticPlayingRef.current)
            : yt.isPlaying;
          if (!uiPlayingState) handlePlayPauseToggle();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          const uiPlayingState = nativeAndroid && !videoEnabled
            ? (nativeIsPlaying || nativeShouldPlayRef.current || optimisticPlayingRef.current)
            : yt.isPlaying;
          if (uiPlayingState) handlePlayPauseToggle();
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => handlePrev());
        navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
        navigator.mediaSession.setActionHandler('seekto', (d) => { if (d.seekTime != null) handleSeek(d.seekTime); });
      }

      bindNativeMediaControls();
      syncNativeMediaControls(playableSong, true);
    } catch (e) {
      console.error('Playback error:', e);
    } finally {
      if (playStartTimeoutRef.current && playRequestIdRef.current === requestId) {
        clearTimeout(playStartTimeoutRef.current);
        playStartTimeoutRef.current = null;
      }
      // Always ensure loading is cleared
      isLoadingSongRef.current = false;
      setIsLoadingSong(false);
      setLoadingSongKey(null);
    }
  }

  useEffect(() => {
    if (!currentSong) return;
    const uiPlayingState = nativeAndroid && !videoEnabled
      ? (nativeIsPlaying || optimisticPlaying)
      : yt.isPlaying;
    syncNativeMediaControls(currentSong, uiPlayingState);
    // Keep mediaSession playbackState in sync (shows correct icon in notification)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = uiPlayingState ? 'playing' : 'paused';
    }
  }, [currentSong, yt.isPlaying, nativeAndroid, videoEnabled, nativeIsPlaying, optimisticPlaying]);

  useEffect(() => {
    if (!nativeAndroid || !currentSong || !canUseNativePlugins()) return;

    const engine = activeEngineRef.current;
    if (engine !== 'web-video' && engine !== 'web-audio') return;

    const uiPlayingState = videoEnabled
      ? yt.isPlaying
      : (nativeIsPlaying || optimisticPlaying || yt.isPlaying);

    NativeMusicPlayer.updateMeta({
      title: currentSong.title || 'Sonix Music',
      artist: currentSong.artist || 'Playing...',
      isPlaying: !!uiPlayingState,
    }).catch(() => {});
  }, [nativeAndroid, currentSong, videoEnabled, yt.isPlaying, nativeIsPlaying, optimisticPlaying]);

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
  function computeNextQueueIndex(direction = 'next', reason = 'manual') {
    const q = queueRef.current;
    if (!q || q.length === 0) return -1;

    const currentIdx = Math.max(0, Math.min(queueIndexRef.current, q.length - 1));
    const currentKey = songKey(q[currentIdx]);

    const findDistinct = (startIdx, step) => {
      if (q.length <= 1) return startIdx;
      let idx = startIdx;
      for (let i = 0; i < q.length; i++) {
        idx = (idx + step + q.length) % q.length;
        if (songKey(q[idx]) !== currentKey) {
          return idx;
        }
      }
      return startIdx;
    };

    if (reason === 'ended' && repeatMode === 'one') {
      return currentIdx;
    }

    if (shuffleEnabled) {
      if (q.length === 1) return currentIdx;
      let idx = Math.floor(Math.random() * q.length);
      if (idx === currentIdx || songKey(q[idx]) === currentKey) {
        idx = findDistinct(idx, 1);
      }
      return idx;
    }

    if (direction === 'previous') {
      return findDistinct(currentIdx, -1);
    }

    if (reason === 'ended' && repeatMode === 'off' && currentIdx >= q.length - 1) {
      return -1;
    }

    return findDistinct(currentIdx, 1);
  }

  function syncQueueIndexToCurrentSong() {
    const q = queueRef.current;
    const activeSong = currentSongRef.current;
    if (!q || q.length === 0 || !activeSong) return;
    const key = songKey(activeSong);
    const idx = q.findIndex((s) => songKey(s) === key);
    if (idx >= 0) {
      queueIndexRef.current = idx;
    }
  }

  function scheduleQueueRecovery(targetSong, reason) {
    if (queueRecoveryRef.current.timer) {
      clearTimeout(queueRecoveryRef.current.timer);
      queueRecoveryRef.current.timer = null;
    }

    const targetKey = songKey(targetSong);
    const nextAttempts = reason === 'recovery'
      ? queueRecoveryRef.current.attempts + 1
      : 1;

    if (nextAttempts > 2) {
      queueRecoveryRef.current = { timer: null, targetKey: '', attempts: 0 };
      return;
    }

    queueRecoveryRef.current = {
      timer: setTimeout(() => {
        const activeSong = currentSongRef.current;
        const stillTarget = activeSong && songKey(activeSong) === targetKey;
        const isPlayingNow = nativeAndroid
          ? (nativeIsPlaying || nativeShouldPlayRef.current)
          : yt.isPlaying;

        if (stillTarget && !isPlayingNow && !isLoadingSongRef.current) {
          handleNext('recovery');
        }
      }, 9000),
      targetKey,
      attempts: nextAttempts,
    };
  }

  function handleNext(reason = 'manual') {
    const q = queueRef.current;
    if (!q || q.length === 0) return;

    syncQueueIndexToCurrentSong();

    const now = Date.now();
    if (now - lastQueueAdvanceRef.current.at < 650 && lastQueueAdvanceRef.current.action === `next:${reason}`) {
      return;
    }

    const nextIdx = computeNextQueueIndex('next', reason);
    if (nextIdx < 0) {
      setOptimisticPlaying(false);
      return;
    }

    lastQueueAdvanceRef.current = { at: now, action: `next:${reason}` };
    queueIndexRef.current = nextIdx;
    isLoadingSongRef.current = false; // force-reset guard
    const targetSong = q[nextIdx];
    playSongDirect(targetSong, null, true);

    if (reason === 'ended' || reason === 'recovery') {
      scheduleQueueRecovery(targetSong, reason);
    } else {
      if (queueRecoveryRef.current.timer) {
        clearTimeout(queueRecoveryRef.current.timer);
      }
      queueRecoveryRef.current = { timer: null, targetKey: '', attempts: 0 };
    }
  }

  function handlePrev() {
    const q = queueRef.current;
    if (!q || q.length === 0) return;

    syncQueueIndexToCurrentSong();

    const now = Date.now();
    if (now - lastQueueAdvanceRef.current.at < 650 && lastQueueAdvanceRef.current.action === 'previous:manual') {
      return;
    }

    const prevIdx = computeNextQueueIndex('previous', 'manual');
    if (prevIdx < 0) return;

    lastQueueAdvanceRef.current = { at: now, action: 'previous:manual' };
    queueIndexRef.current = prevIdx;
    isLoadingSongRef.current = false; // force-reset guard
    playSongDirect(q[prevIdx], null, true);
  }

  // Auto-play next on song end
  useEffect(() => {
    yt.onEndRef.current = () => handleNext('ended');
  });

  useEffect(() => {
    const recovery = queueRecoveryRef.current;
    const activeSong = currentSongRef.current;
    if (!recovery.targetKey || !activeSong) return;
    if (songKey(activeSong) !== recovery.targetKey) return;

    const isPlayingNow = nativeAndroid
      ? (nativeIsPlaying || nativeShouldPlayRef.current)
      : yt.isPlaying;
    if (isPlayingNow || isLoadingSong) {
      if (recovery.timer) {
        clearTimeout(recovery.timer);
      }
      queueRecoveryRef.current = { timer: null, targetKey: '', attempts: 0 };
    }
  }, [currentSong, nativeAndroid, nativeIsPlaying, yt.isPlaying, isLoadingSong]);

  useEffect(() => {
    return () => {
      if (queueRecoveryRef.current.timer) {
        clearTimeout(queueRecoveryRef.current.timer);
        queueRecoveryRef.current.timer = null;
      }
    };
  }, []);

  // ───── Open playlist ─────
  async function openPlaylist(pl) {
    setView('playlist');
    setActivePlaylist(pl);
    setMobileMenuOpen(false);
    setLoading(true);
    try {
      const col = pl.collection || 'songs';
      const res = await fetch(apiPath(`/api/songs?source=${col === 'songs' ? 'jiosaavn' : 'spotify'}&limit=50`));
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
      const res = await fetch(apiPath(`/api/playlist/${pl._id}`), {
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
    const safe = Math.max(0, Math.min(100, Number(v) || 0));
    setVolumeState(safe);
    if (!nativeAndroid) {
      yt.setVolume(safe);
    }
  }

  async function resolveAudioStreamForSong(song, videoId, options = {}) {
    if (!song) return null;
    const key = songKey(song);
    const preferFast = options?.prefetch === true;

    if (isLikelyDirectAudioUrl(song.url || '')) {
      try { localStorage.setItem(`sonix_stream_${key}`, song.url); } catch {}
      streamUrlCacheRef.current.set(key, song.url);
      return song.url;
    }

    const cachedStream = streamUrlCacheRef.current.get(key) || localStorage.getItem(`sonix_stream_${key}`);
    if (cachedStream && /^https?:\/\//i.test(cachedStream)) {
      return cachedStream;
    }

    if (pendingStreamResolveRef.current.has(key)) {
      return pendingStreamResolveRef.current.get(key);
    }

    const resolverTask = (async () => {
      const androidFastStreamTimeout = preferFast ? 3500 : (nativeAndroid ? 5000 : 4500);
      const androidFastLookupTimeout = preferFast ? 3000 : (nativeAndroid ? 4500 : 4000);
      let resolved = null;
      let fallbackVideoId = normalizeVideoId(videoId);

      if (!resolved && fallbackVideoId) {
        try {
          const data = await fetchJsonWithTimeout(
            apiPath(`/api/yt-stream?videoId=${encodeURIComponent(fallbackVideoId)}`),
            nativeAndroid ? androidFastStreamTimeout : 10000
          );
          if (data?.streamUrl) {
            resolved = data.streamUrl;
          }
        } catch {}
      }

      if (!resolved) {
        try {
          const q = `${song.title || ''} ${song.artist || ''}`.trim();
          if (q) {
            const data = await fetchJsonWithTimeout(
              apiPath(`/api/youtube-search?q=${encodeURIComponent(q)}&stream=true`),
              nativeAndroid ? androidFastLookupTimeout : 9000
            );
            if (data?.videoId) {
              const discoveredVideoId = normalizeVideoId(data.videoId);
              if (discoveredVideoId) {
                fallbackVideoId = discoveredVideoId;
                videoIdCacheRef.current.set(key, discoveredVideoId);
                try { localStorage.setItem(`yt_vid_${key}`, discoveredVideoId); } catch {}
              }
            }
            if (data?.streamUrl) {
              resolved = data.streamUrl;
            }
          }
        } catch {}
      }

      if (!resolved && fallbackVideoId) {
        try {
          const data = await fetchJsonWithTimeout(
            apiPath(`/api/yt-stream?videoId=${encodeURIComponent(fallbackVideoId)}`),
            nativeAndroid ? androidFastStreamTimeout : 10000
          );
          if (data?.streamUrl) {
            resolved = data.streamUrl;
          }
        } catch {}
      }

      if (!resolved && song.url && /^https?:\/\//i.test(song.url)) {
        try {
          const params = new URLSearchParams();
          params.set('url', song.url);
          params.set('title', song.title || '');
          params.set('artist', song.artist || '');
          params.set('type', 'song');
          params.set('source', song.source || 'songs');
          const data = await fetchJsonWithTimeout(
            apiPath(`/api/stream?${params.toString()}`),
            nativeAndroid ? androidFastStreamTimeout : 10000
          );
          if (data?.streamUrl) {
            resolved = data.streamUrl;
          }
          if (data?.videoId) {
            const canonicalVideoId = normalizeVideoId(data.videoId);
            if (canonicalVideoId) {
              fallbackVideoId = canonicalVideoId;
              videoIdCacheRef.current.set(key, canonicalVideoId);
              try { localStorage.setItem(`yt_vid_${key}`, canonicalVideoId); } catch {}
            }
          }
        } catch {}
      }

      if (resolved && /^https?:\/\//i.test(resolved)) {
        streamUrlCacheRef.current.set(key, resolved);
        try { localStorage.setItem(`sonix_stream_${key}`, resolved); } catch {}
      }

      return resolved;
    })().finally(() => {
      pendingStreamResolveRef.current.delete(key);
    });

    pendingStreamResolveRef.current.set(key, resolverTask);
    return resolverTask;
  }

  async function switchToVideoMode() {
    if (videoEnabled) return;
    setVideoEnabled(true);
    if (!currentSong) return;

    const resumeAt = yt.currentTime || 0;

    if (nativeAndroid) {
      try {
        await NativeMusicPlayer.pause();
      } catch {}
      setNativeIsPlaying(false);
      setOptimisticPlaying(false);
      nativeShouldPlayRef.current = false;
    }

    const videoId = currentSong.videoId || await resolveSongVideoId(currentSong);
    if (!videoId) return;

    await enforceEngineLock('web-video');
    const started = yt.playVideoById(videoId);
    if (!started) {
      await yt.searchAndPlay(currentSong.title || '', currentSong.artist || '', currentSong.type || 'song');
    }
    activeEngineRef.current = 'web-video';

    if (!currentSong.videoId) {
      setCurrentSong(prev => prev ? { ...prev, videoId } : prev);
    }
    if (resumeAt > 0) {
      setTimeout(() => yt.seekTo(resumeAt), 350);
    }
  }

  async function switchToAudioMode() {
    if (!videoEnabled) return;
    setVideoEnabled(false);
    if (!currentSong) return;

    const resumeAt = yt.currentTime || 0;

    if (nativeAndroid) {
      const videoId = currentSong.videoId || await resolveSongVideoId(currentSong);
      const nativeSourceSong = {
        ...currentSong,
        // Avoid direct source URL fallback here (can be short preview clips).
        // Prefer full-length stream resolved from the active video id.
        url: '',
        source: 'youtube',
        ...(videoId ? { videoId } : {}),
      };

      // Fast-path: while video continues, resolve a native stream and switch with minimal gap.
      if (videoId) {
        try {
          const streamUrl = await resolveAudioStreamForSong(nativeSourceSong, videoId, { prefetch: true });
          if (streamUrl) {
            const queueSource = queueRef.current?.length ? queueRef.current : [currentSong];
            const selectedSong = { ...currentSong, url: streamUrl, videoId };
            const { queue: nativeQueue, index: nativeIndex } = buildNativeQueue(queueSource, selectedSong, streamUrl);
            if (!nativeQueue.length) {
              throw new Error('Native queue is empty after stream resolution');
            }
            await enforceEngineLock('native-audio');
            await NativeMusicPlayer.playQueue({
              queue: nativeQueue,
              index: nativeIndex,
              shuffle: shuffleEnabled,
              repeatMode,
            });

            // Pause video only after native queue is accepted to avoid audible dead-air.
            yt.pause();

            setCurrentSong(prev => prev ? { ...prev, url: streamUrl, videoId } : prev);
            nativeTrackLoadedRef.current = true;
            nativeShouldPlayRef.current = true;
            setNativeIsPlaying(true);
            setOptimisticPlaying(true);
            activeEngineRef.current = 'native-audio';

            if (resumeAt > 0) {
              setTimeout(() => {
                NativeMusicPlayer.seekTo({ positionMs: resumeAt * 1000 }).catch(() => {});
              }, 350);
            }
            return;
          }
        } catch {}
      }

      activeEngineRef.current = 'none';
      nativeTrackLoadedRef.current = false;
      nativeShouldPlayRef.current = false;
      setNativeIsPlaying(false);
      isLoadingSongRef.current = false;
      await playSongDirect(nativeSourceSong, queueRef.current?.length ? queueRef.current : null, true);
      if (resumeAt > 0) {
        setTimeout(() => {
          NativeMusicPlayer.seekTo({ positionMs: resumeAt * 1000 }).catch(() => {});
        }, 800);
      }
      return;
    }

    yt.pause();

    const videoId = currentSong.videoId || await resolveSongVideoId(currentSong);
    if (!videoId) return;

    const streamUrl = await resolveAudioStreamForSong(currentSong, videoId);
    if (streamUrl) {
      await enforceEngineLock('web-audio');
      yt.playStream(streamUrl, videoId);
      activeEngineRef.current = 'web-audio';
      if (resumeAt > 0) {
        setTimeout(() => yt.seekTo(resumeAt), 120);
      }
      if (!currentSong.videoId) {
        setCurrentSong(prev => prev ? { ...prev, videoId } : prev);
      }
      return;
    }

    // Stay in audio mode if stream cannot be resolved; do not auto-switch back to video.
    setOptimisticPlaying(false);
    activeEngineRef.current = 'none';
  }

  useEffect(() => {
    yt.onErrorRef.current = async () => {
      if (!nativeAndroid || !videoEnabled || !currentSong) return;
      try {
        await switchToAudioMode();
      } catch (e) {
        console.error('Android video fallback failed:', e);
        setVideoEnabled(false);
      }
    };

    return () => {
      yt.onErrorRef.current = null;
    };
  }, [nativeAndroid, videoEnabled, currentSong]);



  async function handlePlayPauseToggle() {
    if (nativeAndroid && currentSong && !videoEnabled) {
      try {
        const canControlNative =
          activeEngineRef.current === 'native-audio' &&
          (
            nativeTrackLoadedRef.current ||
            nativeIsPlaying ||
            nativeShouldPlayRef.current ||
            optimisticPlaying
          );

        if (canControlNative) {
          const currentlyPlaying = nativeIsPlaying || nativeShouldPlayRef.current || optimisticPlaying;

          if (currentlyPlaying) {
            setOptimisticPlaying(false);
            setNativeIsPlaying(false);
            nativeShouldPlayRef.current = false;
            await NativeMusicPlayer.pause();
          } else {
            setOptimisticPlaying(true);
            setNativeIsPlaying(true);
            nativeShouldPlayRef.current = true;
            nativeTrackLoadedRef.current = true;
            await NativeMusicPlayer.resume();
          }
          return;
        }

        // First-open bootstrap: if native engine has no loaded track yet,
        // start the current song directly so play/pause works immediately.
        activeEngineRef.current = 'none';
        nativeTrackLoadedRef.current = false;
        nativeShouldPlayRef.current = false;
        setOptimisticPlaying(true);
        await playSongDirect(currentSong, queueRef.current?.length ? queueRef.current : null, true);
        return;
      } catch (e) {
        console.error('Native play/pause failed, falling back to web toggle:', e);
      }
    }

    if (!currentSong) return;

    if (yt.isPlaying) {
      setOptimisticPlaying(false);
      yt.pause();
    } else {
      setOptimisticPlaying(true);
      // Always use currentSong.videoId as the source of truth — never rely on loadedVideoIdRef
      // which can be stale after navigating away and back
      const { videoId } = currentSong;
      if (videoId) {
        if (videoEnabled) {
          if (yt.loadedVideoIdRef.current === videoId) {
            yt.play();
          } else {
            yt.playVideoById(videoId);
          }
        } else {
          const a = yt.audioElement;
          if (a && a.src && a.src !== window.location.href) {
            yt.play();
          } else {
            const streamUrl = await resolveAudioStreamForSong(currentSong, videoId);
            if (streamUrl) yt.playStream(streamUrl, videoId);
            else yt.playVideoById(videoId);
          }
        }
      } else {
        const fallbackVideoId = await resolveSongVideoId(currentSong);
        if (fallbackVideoId) {
          const streamUrl = await resolveAudioStreamForSong(currentSong, fallbackVideoId);
          if (streamUrl) yt.playStream(streamUrl, fallbackVideoId);
          else yt.playVideoById(fallbackVideoId);
          setCurrentSong(prev => prev ? { ...prev, videoId: fallbackVideoId } : prev);
        } else {
          yt.searchAndPlay(currentSong.title, currentSong.artist, currentSong.type || 'song');
        }
      }
    }
  }

  function handleSeek(timeInSeconds) {
    if (!currentSong) return;
    const t = Math.max(0, timeInSeconds);
    const uiDuration = yt.duration > 0 ? yt.duration : Math.max(0, Number(currentSong?.duration || 0));

    if (nativeAndroid && !videoEnabled && canUseNativePlugins() && nativeTrackLoadedRef.current) {
      // Optimistically update seek bar immediately in native mode too.
      yt.updateNativeTime(t, uiDuration > 0 ? uiDuration : undefined);
      NativeMusicPlayer.seekTo({ positionMs: t * 1000 }).catch(() => {});
    } else {
      yt.seekTo(t);
      // Optimistically update the displayed time immediately
      yt.updateNativeTime(t, uiDuration > 0 ? uiDuration : undefined);
    }
  }

  // Helper: get X position from mouse or touch event
  function getEventX(e) {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX;
    return e.clientX;
  }

  function seekFromBarEvent(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = getEventX(e);
    const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    const durationForSeek = yt.duration > 0 ? yt.duration : Math.max(0, Number(currentSong?.duration || 0));
    const t = pct * durationForSeek;
    handleSeek(t);
  }

  // When full player opens and song is set but not playing — auto-resume
  useEffect(() => {
    if (!fullPlayerOpen || !currentSong || nativeAndroid || !videoEnabled) return;
    // If nothing is loaded or wrong video is loaded, reload it
    const { videoId } = currentSong;
    if (!videoId) return;
    if (!yt.isPlaying && yt.loadedVideoIdRef.current !== videoId) {
      yt.playVideoById(videoId);
    }
  }, [fullPlayerOpen, videoEnabled, currentSong, nativeAndroid, yt.isPlaying]);

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

  const webUiPlaying = yt.isPlaying || (isLoadingSong && optimisticPlaying);
  const nativeUiPlaying =
    nativeIsPlaying ||
    nativeShouldPlayRef.current ||
    (Date.now() - lastNativeProgressRef.current.at < 4000) ||
    (isLoadingSong && optimisticPlaying);
  const activePlaying = nativeAndroid
    ? (videoEnabled ? webUiPlaying : nativeUiPlaying)
    : webUiPlaying;
  const durationForUi = yt.duration > 0 ? yt.duration : Math.max(0, Number(currentSong?.duration || 0));
  const repeatLabel = repeatMode === 'off' ? '🔁' : repeatMode === 'one' ? '🔂' : '🔁';

  useEffect(() => {
    optimisticPlayingRef.current = optimisticPlaying;
  }, [optimisticPlaying]);

  // Reconcile optimistic state once YT confirms
  useEffect(() => {
    setOptimisticPlaying(false);
  }, [yt.isPlaying]);

  useEffect(() => {
    if (nativeAndroid && !nativeShouldPlayRef.current && !nativeIsPlaying) {
      setOptimisticPlaying(false);
    }
  }, [nativeAndroid, nativeIsPlaying]);

  // Gestures for full player
  const touchStartX = useRef(0);
  const seekDragActiveRef = useRef(false);
  const seekDragTargetRef = useRef(null);
  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(diff) > 70) {
      if (diff > 0) handlePrev();
      else handleNext();
    }
  };

  function updateSeekFromClientX(clientX, targetEl) {
    if (!targetEl || !currentSong) return;
    const rect = targetEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const durationForSeek = yt.duration > 0 ? yt.duration : Math.max(0, Number(currentSong?.duration || 0));
    const t = pct * durationForSeek;
    handleSeek(t);
  }

  function startSeekDrag(e) {
    const target = e.currentTarget;
    seekDragActiveRef.current = true;
    seekDragTargetRef.current = target;
    updateSeekFromClientX(getEventX(e), target);
    if (e?.cancelable) e.preventDefault();
  }

  useEffect(() => {
    const move = (e) => {
      if (!seekDragActiveRef.current) return;
      const point = e.touches?.[0]?.clientX ?? e.clientX;
      if (typeof point === 'number') {
        updateSeekFromClientX(point, seekDragTargetRef.current);
      }
    };

    const end = () => {
      seekDragActiveRef.current = false;
      seekDragTargetRef.current = null;
    };

    window.addEventListener('mousemove', move, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, [currentSong, yt.duration]);

  function loadMore() { 
    loadSongs(page + 1, { search, genre, source }); 
  }

  async function handleTrendingViewAll() {
    setSearch('');
    setView('home');
    if (source !== 'all') {
      setSource('all');
      await loadSongs(1, { genre, source: 'all' });
    } else if (!songs.length) {
      await loadSongs(1, { genre, source });
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = contentScrollRef.current;
        const target = browseAllRef.current;
        if (scroller && target) {
          const top = Math.max(0, target.offsetTop - 8);
          scroller.scrollTo({ top, behavior: 'smooth' });
        } else {
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  useEffect(() => {
    if (!nativeAndroid || view !== 'home') return;
    const timer = setInterval(() => {
      if (!loading && songs.length < 5) {
        loadSongs(1, { genre, source });
      }
    }, 12000);
    return () => clearInterval(timer);
  }, [nativeAndroid, view, loading, songs.length, genre, source]);

  const displaySongs = search.trim() ? searchResults : songs;
  // For liked view: match from cachedSongs first, then fill in any YT/unknown songs from likedSongObjects
  const likedSongsList = (() => {
    const fromCache = cachedSongs.filter(s => {
      const k = s.songId || s._id || s.videoId || `${s.title || ''}::${s.artist || ''}`;
      return likedSongs.has(k);
    });
    const cacheKeys = new Set(fromCache.map(s => s.songId || s._id || s.videoId || `${s.title || ''}::${s.artist || ''}`));
    // Add liked song objects that aren't already covered by cachedSongs (e.g. YouTube songs)
    const fromObjects = (likedSongObjects || []).filter(s => {
      const k = s.songId || s._id || s.videoId || `${s.title || ''}::${s.artist || ''}`;
      return likedSongs.has(k) && !cacheKeys.has(k);
    });
    return [...fromCache, ...fromObjects];
  })();
  const activeSongs = (view === 'liked' && !search.trim())
    ? likedSongsList
    : (view === 'recent' && !search.trim())
      ? recentlyPlayed
      : (view === 'userplaylist' && !search.trim())
        ? userPlaylistSongs
        : displaySongs;

  const showLoginNudge = !authLoading && !user && !showAuthModal;
  const heroSongs = songs.slice(0, 4);
  const heroCount = Math.max(1, heroSongs.length);
  const normalizedHeroIndex = activeHeroIndex % heroCount;
  const activeHeroSong = heroSongs[normalizedHeroIndex] || songs[0];

  const handleHeroTouchStart = (e) => {
    heroTouchStartXRef.current = e.touches?.[0]?.clientX || 0;
  };

  const handleHeroTouchEnd = (e) => {
    if (heroCount <= 1) return;
    const endX = e.changedTouches?.[0]?.clientX || 0;
    const delta = endX - heroTouchStartXRef.current;
    if (Math.abs(delta) < 40) return;

    if (delta < 0) {
      setActiveHeroIndex(prev => (prev + 1) % heroCount);
    } else {
      setActiveHeroIndex(prev => (prev - 1 + heroCount) % heroCount);
    }
  };

  return (
    <div className={`app-layout ${showLoginNudge ? 'has-login-banner' : ''}`}>
      <GlobalErrorHandler />
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
        <div className="sidebar-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 className="sidebar-brand">SONIX MUSIC</h1>
          <button className="sidebar-close-btn" onClick={() => setMobileMenuOpen(false)} style={{ display: mobileMenuOpen ? 'flex' : 'none', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '6px', borderRadius: '8px' }}>✕</button>
        </div>
        
        <nav className="sidebar-nav">
          <div className="nav-section-title">Menu</div>
          <button className={`nav-item ${view === 'home' && !genre ? 'active' : ''}`} onClick={() => { setView('home'); setGenre(''); loadSongs(1); setMobileMenuOpen(false); }}>
            <span className="icon">🏠</span> Home
          </button>
          <button className={`nav-item ${view === 'search' ? 'active' : ''}`} onClick={() => { setView('search'); setMobileMenuOpen(false); }}>
            <span className="icon">🔍</span> Explore
          </button>
          <div className="nav-section-title">Your Library</div>
          <button className={`nav-item ${view === 'liked' ? 'active' : ''}`} onClick={() => { setView('liked'); setMobileMenuOpen(false); }}>
            <span className="icon">💚</span> Liked Songs
          </button>
          <button className={`nav-item ${view === 'recent' ? 'active' : ''}`} onClick={() => { setView('recent'); setMobileMenuOpen(false); }}>
            <span className="icon">🕐</span> Recently Played
          </button>

          {user && (
            <>
              <div className="nav-section-title">Collections</div>
              {userPlaylists.map((pl) => (
                <button key={pl._id} className={`nav-item ${activePlaylist?._id === pl._id ? 'active' : ''}`} onClick={() => openUserPlaylist(pl)}>
                  <span className="icon">📁</span> {pl.name}
                </button>
              ))}
            </>
          )}

          <div className="nav-section-title">Browse Genres</div>
          {playlists.slice(0, 6).map((pl, i) => (
            <button key={i} className={`nav-item ${activePlaylist?.name === pl.name ? 'active' : ''}`} onClick={() => openPlaylist(pl)}>
              <span className="icon">🎧</span> {pl.name.replace(' Hits', '')}
            </button>
          ))}
          
          <div style={{ marginTop: 'auto', padding: '20px 10px' }}>
            {user ? (
              <button className="nav-item" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={logout}>
                <span className="icon">👤</span> {user.name.split(' ')[0]} (Logout)
              </button>
            ) : (
              <button className="nav-item active" onClick={openAuthModal}>
                <span className="icon">🔐</span> Sign In / Join
              </button>
            )}
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
                  const res = await fetch(apiPath('/api/upload'), {
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
            <button
              className={`voice-search-btn ${isListening ? 'listening' : ''}`}
              onClick={startVoiceSearch}
              style={{ padding: '8px', marginLeft: 'auto', background: isListening ? 'rgba(124, 58, 237, 0.2)' : 'transparent', border: 'none', borderRadius: '50%', color: isListening ? '#7c3aed' : '#9ca3af', cursor: 'pointer', transition: 'all 0.3s' }}
              title={isListening ? 'Stop listening' : 'Voice search'}
              aria-label="Voice search"
            >
              {isListening ? '⏹' : '🎤'}
            </button>
          </div>
        </div>

        <div className="content-scroll" ref={contentScrollRef}>
          {view === 'home' && !search.trim() && (
            <div className="fade-in">
              {/* Premium Hero Carousel */}
              <div
                className="premium-hero"
                style={{ cursor: 'pointer' }}
                onTouchStart={handleHeroTouchStart}
                onTouchEnd={handleHeroTouchEnd}
                onClick={(e) => {
                if (e.target.closest('.hero-indicator')) return;
                activeHeroSong && playSongDirect(activeHeroSong, songs);
              }}>
                <img 
                  src={(activeHeroSong?.image || activeHeroSong?.thumbnail || 'https://picsum.photos/seed/trending/800/400').replace('mqdefault', 'hqdefault')} 
                  className="hero-bg-img" 
                  alt="" 
                />
                <div className="hero-overlay"></div>
                <div className="hero-content">
                  <span className="hero-tag">TRENDING NOW</span>
                  <h1 className="hero-title">{decodeHtml(activeHeroSong?.title) || 'Sonix Music Premium'}</h1>
                  <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 24, fontSize: 18, fontWeight: 500 }}>
                    Listen to {decodeHtml(activeHeroSong?.artist) || 'the world\'s best artists'} now on Sonix Music HD.
                  </p>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button className="hero-btn">Play Now</button>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                      {heroSongs.map((_, idx) => (
                        <div 
                          key={idx} 
                          className="hero-indicator"
                          onClick={(e) => { e.stopPropagation(); setActiveHeroIndex(idx); }}
                          style={{ 
                            width: idx === normalizedHeroIndex ? 30 : 10, 
                            height: 10, 
                            borderRadius: 5, 
                            background: idx === normalizedHeroIndex ? 'var(--accent-primary)' : 'rgba(255,255,255,0.2)',
                            cursor: 'pointer',
                            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: idx === normalizedHeroIndex ? '0 0 15px var(--accent-primary)' : 'none'
                          }} 
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="hero-scroll-nav" aria-label="Trending banners">
                {heroSongs.map((s, idx) => (
                  <button
                    key={`${songKey(s)}-${idx}`}
                    className={`hero-scroll-chip ${idx === normalizedHeroIndex ? 'active' : ''}`}
                    onClick={() => setActiveHeroIndex(idx)}
                  >
                    {decodeHtml(s?.title) || `Banner ${idx + 1}`}
                  </button>
                ))}
              </div>

              {/* Trending Row */}
              <div className="section-header">
                <h2>Trending This Week</h2>
                <button className="view-all" onClick={handleTrendingViewAll}>View All</button>
              </div>
              <div className="horizontal-scroll">
                {songs.slice(0, 10).map((s, i) => (
                  <div key={i} className="premium-card" onClick={() => playSongDirect(s, songs)}>
                    <div className="card-img-wrap">
                      <img src={s.thumbnail || s.image || 'https://picsum.photos/seed/sonix/200'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                      <div className="card-play-btn">▶</div>
                    </div>
                    <div className="card-title">{decodeHtml(s.title)}</div>
                    <div className="card-subtitle">{decodeHtml(s.artist)}</div>
                  </div>
                ))}
              </div>

              {homeSectionsReady && (
                <>
                  {/* New Releases Row */}
                  <div className="section-header">
                    <h2>New Releases</h2>
                    <button className="view-all" onClick={handleTrendingViewAll}>Browse</button>
                  </div>
                  <div className="horizontal-scroll">
                    {songs.slice(10, 20).map((s, i) => (
                      <div key={i} className="premium-card" onClick={() => playSongDirect(s, songs)}>
                        <div className="card-img-wrap">
                          <img src={s.thumbnail || s.image || 'https://picsum.photos/seed/sonix2/200'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                          <div className="card-play-btn">▶</div>
                        </div>
                        <div className="card-title">{decodeHtml(s.title)}</div>
                        <div className="card-subtitle">{decodeHtml(s.artist)}</div>
                      </div>
                    ))}
                  </div>

                  {/* Top Artists (Circular) */}
                  <div className="section-header">
                    <h2>Top Singers</h2>
                  </div>
                  <div className="horizontal-scroll" style={{ paddingBottom: 50 }}>
                    {Array.from(new Set(songs.map(s => s.artist))).slice(0, 8).map((artist, i) => (
                      <div key={i} className="artist-card" onClick={() => { setSearch(artist); setView('search'); }}>
                        <img src={`https://picsum.photos/seed/${artist}/200`} className="artist-img" alt="" />
                        <div className="artist-name">{decodeHtml(artist)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Standard List Title below */}
              <div className="section-header" ref={browseAllRef}>
                <h2>Browse All Tracks</h2>
                <span style={{ color: '#9ca3af', fontSize: '13px' }}>{totalSongs.toLocaleString()} tracks</span>
              </div>
              <div className="filter-pills fade-in" style={{ marginBottom: 20 }}>
                <button className={`pill ${source === 'all' ? 'active' : ''}`} onClick={() => filterSource('all')}>All Sources</button>
                <button className={`pill ${source === 'jiosaavn' ? 'active' : ''}`} onClick={() => filterSource('jiosaavn')}>Indian Hits</button>
                <button className={`pill ${source === 'spotify' ? 'active' : ''}`} onClick={() => filterSource('spotify')}>Spotify Global</button>
              </div>
            </div>
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
              const queueSource = activeSongs;
              const key = song.songId || song._id || song.videoId || `${song.title || ''}::${song.artist || ''}`;
              const isLiked = likedSongs.has(key);
              const isCurrentSong = currentSong && songKey(currentSong) === key;
              return (
              <div
                key={song._id || song.songId || song.videoId || i}
                className={`song-row fade-in ${isCurrentSong ? 'playing' : ''}`}
                style={{ animationDelay: `${Math.min(i * 15, 200)}ms` }}
                onClick={() => playSongDirect(song, queueSource)}
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
                <img 
                  className="song-img" 
                  src={song.thumbnail || song.image || 'https://picsum.photos/seed/sonixart/200'} 
                  alt="" 
                  loading="lazy" 
                  onError={(e) => { e.target.src = 'https://picsum.photos/seed/sonix/200'; }} 
                />
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
                      onClick={() => toggleLike(key, song)}
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

          {!loading && !search.trim() && (
            displaySongs.length > 0 && 
            displaySongs.length < totalSongs
          ) && (
            <div style={{ textAlign: 'center', padding: '24px' }}>
              <button className="pill" onClick={loadMore} style={{ padding: '10px 32px' }}>Load More</button>
            </div>
          )}

            {/* YouTube Results Grid */}
            {ytResults.length > 0 && (
              <>
                <div className="section-header fade-in" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
                  <h2>YouTube Discovery</h2>
                  <span style={{ color: '#ff4444', fontSize: '13px', fontWeight: 'bold' }}>
                    {isSearchingYT ? '⏳ Loading...' : '▶ YT GLOBAL'}
                  </span>
                </div>
                <div className="yt-results-grid">
                  {ytResults.map((v) => {
                    const ytSong = {
                      ...v,
                      image: v.thumbnail || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
                      source: 'youtube',
                    };
                    const isCurrentYT = currentSong?.videoId === v.videoId;
                    const ytKey = v.videoId;
                    const isLiked = likedSongs.has(ytKey);
                    return (
                      <div
                        key={v.videoId}
                        className={`yt-card ${isCurrentYT ? 'playing' : ''}`}
                        onClick={() => playSongDirect(ytSong, ytResults.map(r => ({
                          ...r,
                          image: r.thumbnail || `https://img.youtube.com/vi/${r.videoId}/hqdefault.jpg`,
                          source: 'youtube',
                        })))}
                      >
                        <div className="yt-card-thumb">
                          <img src={v.thumbnail || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`} alt="" loading="lazy" />
                          <div className="yt-card-play">{isCurrentYT && activePlaying ? '⏸' : '▶'}</div>
                          {isCurrentYT && (
                            <div className="yt-card-eq">
                              <span className="bar"></span><span className="bar"></span><span className="bar"></span>
                            </div>
                          )}
                        </div>
                        <div className="yt-card-info">
                          <div className="yt-card-title">{v.title || 'YouTube Video'}</div>
                          <div className="yt-card-artist">{v.artist || v.channelTitle || 'YouTube'}</div>
                        </div>
                        {user && (
                          <button
                            className="yt-card-like"
                            onClick={(e) => { e.stopPropagation(); toggleLike(ytKey, ytSong); }}
                            title={isLiked ? 'Unlike' : 'Like'}
                          >
                            {isLiked ? '💚' : '🤍'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {isSearchingYT && ytResults.length === 0 && search.trim() && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: 13 }}>
                ⏳ Searching YouTube...
              </div>
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
              <img 
                src={currentSong.thumbnail || currentSong.image || 'https://picsum.photos/seed/sonixart/200'} 
                alt="" 
                onError={(e) => { e.target.src = 'https://picsum.photos/seed/sonix/200'; }}
              />
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
                <div
                  className="progress-track"
                  onClick={(e) => { e.stopPropagation(); seekFromBarEvent(e); }}
                  onPointerDown={(e) => { e.stopPropagation(); startSeekDrag(e); }}
                  onPointerUp={(e) => { e.stopPropagation(); seekFromBarEvent(e); }}
                  onMouseDown={(e) => { e.stopPropagation(); startSeekDrag(e); }}
                  onTouchStart={(e) => { e.stopPropagation(); startSeekDrag(e); }}
                  onTouchEnd={(e) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); seekFromBarEvent(e); }}
                >
                  <div className="progress-filled" style={{ width: durationForUi ? `${(yt.currentTime / durationForUi) * 100}%` : '0%' }}></div>
                </div>
                <span className="time">{fmt(durationForUi)}</span>
              </div>
            </div>

            <div className="player-extra">
              {/* Mode Switch removed as requested - Always shows video/large artwork */}
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

      {/* Full Screen Player — Spotify style */}
      <div className={`full-player ${fullPlayerOpen ? 'open' : ''}`}>
        {currentSong && (
          <div className="full-player-content spotify-player">
            {/* Blurred album art background */}
            <div
              className="sp-bg"
              style={{ backgroundImage: currentSong.image ? `url(${currentSong.image})` : 'none' }}
            />
            <div className="sp-bg-overlay" />

            {/* Header */}
            <div className="sp-header">
              <button className="sp-down-btn" onClick={() => setFullPlayerOpen(false)}>▼</button>
              <div className="sp-mode-switch">
                <button className={videoEnabled ? '' : 'active'} onClick={switchToAudioMode}>Audio</button>
                  <button className={videoEnabled ? 'active' : ''} onClick={switchToVideoMode} title={nativeAndroid ? 'Video mode may stop background playback on Android' : 'Video'}>Video</button>
              </div>
              <span style={{ width: 36 }} />
            </div>

            {/* Disc artwork */}
            <div
              className={`sp-disc-wrap ${videoEnabled ? 'is-video' : ''}`}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {videoEnabled ? (
                <div className="sp-video-container">
                  <div id="full-player-video-box" />
                </div>
              ) : (
                <div className="sp-disc">
                  <div className="sp-disc-ring" />
                  {currentSong.image ? (
                    <img 
                      src={currentSong.image} 
                      className={`sp-disc-img ${activePlaying ? 'spin' : ''}`} 
                      alt="" 
                      onError={(e) => { e.target.src = 'https://picsum.photos/seed/sonix/400'; }}
                    />
                  ) : (
                    <div className="sp-disc-img sp-disc-placeholder">🎵</div>
                  )}
                  <div className="sp-disc-center" />
                </div>
              )}
            </div>

            {/* Song info + like */}
            <div className="sp-info-row">
              <div className="sp-info">
                <div className="sp-title">{decodeHtml(currentSong.title)}</div>
                <div className="sp-artist">{decodeHtml(currentSong.artist)}</div>
              </div>
              {user && (
                <button
                  className="sp-like-btn"
                  onClick={() => toggleLike(songKey(currentSong), currentSong)}
                >
                  {likedSongs.has(songKey(currentSong)) ? '💚' : '🤍'}
                </button>
              )}
            </div>

            {/* Progress */}
            <div className="sp-progress-wrap">
              <div
                className="sp-progress-track"
                onClick={seekFromBarEvent}
                onPointerDown={startSeekDrag}
                onPointerUp={seekFromBarEvent}
                onMouseDown={startSeekDrag}
                onTouchStart={startSeekDrag}
                onTouchEnd={(e) => { if (e.cancelable) e.preventDefault(); seekFromBarEvent(e); }}
              >
                <div className="sp-progress-fill" style={{ width: durationForUi ? `${(yt.currentTime / durationForUi) * 100}%` : '0%' }} />
                <div className="sp-progress-thumb" style={{ left: durationForUi ? `${(yt.currentTime / durationForUi) * 100}%` : '0%' }} />
              </div>
              <div className="sp-times">
                <span>{fmt(yt.currentTime)}</span>
                <span>{fmt(durationForUi)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="sp-controls">
              <button className={`sp-ctrl-btn ${shuffleEnabled ? 'active' : ''}`} onClick={handleToggleShuffle} title="Shuffle">
                🔀
              </button>
              <button className="sp-ctrl-btn sp-skip" onClick={handlePrev} title="Previous">⏮</button>
              <button className="sp-play-btn" onClick={handlePlayPauseToggle}>
                {isLoadingSong ? <div className="spinner-small"></div> : activePlaying ? '⏸' : '▶'}
              </button>
              <button className="sp-ctrl-btn sp-skip" onClick={handleNext} title="Next">⏭</button>
              <button className={`sp-ctrl-btn ${repeatMode !== 'off' ? 'active' : ''}`} onClick={handleCycleRepeat} title="Repeat">
                {repeatMode === 'one' ? '🔂' : '🔁'}
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Hidden YouTube player mount point — ref-based, no ID conflict */}
      <div
        className={`yt-video-container ${videoEnabled ? 'visible' : ''} ${videoEnabled && fullPlayerOpen ? 'in-full' : ''}`}
        aria-hidden={!videoEnabled}
      >
        <div ref={yt.containerRef} style={{ width: '100%', height: '100%' }} id="yt-player-placeholder" />
      </div>
      {/* Silent audio element — anchors Android mediaSession so notification panel appears */}
      <audio
        ref={yt.silentAudioRef}
        src="/silence.mp3"
        loop
        playsInline
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      {/* Auth Modal */}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      {/* Voice Search Overlay — Google-style */}
      {isListening && (
        <div className="voice-overlay" onClick={() => { recognitionRef.current?.stop(); }}>
          <div className="voice-modal" onClick={e => e.stopPropagation()}>
            <div className="voice-waves">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
            <p className="voice-label">
              {voiceTranscript ? `"${voiceTranscript}"` : 'Listening...'}
            </p>
            <p className="voice-hint">Speak now — tap anywhere to cancel</p>
            <button className="voice-cancel" onClick={() => recognitionRef.current?.stop()}>✕ Cancel</button>
          </div>
        </div>
      )}

      {/* Add to Playlist Menu */}
      {playlistMenuSong && (
        <AddToPlaylistMenu song={playlistMenuSong} onClose={() => setPlaylistMenuSong(null)} />
      )}

      {/* Login nudge banner — only when not logged in, hidden when modal is open */}
      {showLoginNudge && (
        <div className="login-nudge-banner">
          <span className="login-nudge-text">
            🎵 Log in to like songs, create playlists &amp; sync across devices
          </span>
          <button
            onClick={openAuthModal}
            className="login-nudge-btn"
          >
            Log In
          </button>
        </div>
      )}
    </div>
  );
}
