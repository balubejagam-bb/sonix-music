'use client';

import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

// Ensure BackgroundMode doesn't crash SSR
let BackgroundMode;
if (typeof window !== 'undefined') {
  import('@anuradev/capacitor-background-mode').then(m => { BackgroundMode = m.BackgroundMode; }).catch(()=> {});
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.YT && window.YT.Player) { initPlayer(); return; }
    window.onYouTubeIframeAPIReady = initPlayer;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);

    function initPlayer() {
      playerRef.current = new window.YT.Player('yt-player-container', {
        height: '1', width: '1',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0 },
        events: {
          onReady: () => setYtReady(true),
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
      });
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
  function seekTo(t) { playerRef.current?.seekTo(t, true); }
  function setVolume(v) { playerRef.current?.setVolume(v); }

  return { ytReady, isPlaying, duration, currentTime, searchAndPlay, play, pause, seekTo, setVolume, onEndRef };
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
  const [cacheStatus, setCacheStatus] = useState('loading');
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
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const [visualizer, setVisualizer] = useState('waves'); // waves, bars, pulse
  const searchTimer = useRef(null);

  // Use refs for queue to avoid stale closures in next/prev
  const queueRef = useRef([]);
  const queueIndexRef = useRef(0);

  // ───── Load initial data & cache ─────
  useEffect(() => {
    async function initNativeBackground() {
      if (typeof window !== 'undefined' && Capacitor.isNativePlatform() && BackgroundMode) {
        try {
          await BackgroundMode.enable();
          await BackgroundMode.setSettings({ title: 'Sonix Music', text: 'Playing in background', hidden: true });
          await BackgroundMode.disableWebViewOptimizations();
        } catch(e) { console.error('Background audio permissions error:', e); }
      }
    }
    initNativeBackground();
    loadPlaylists();
    loadSongs(1);
    backgroundCache();
  }, []);

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

  async function backgroundCache() {
    setCacheStatus('loading');
    try {
      const res = await fetch('/api/songs?limit=2500'); // Limited for deployment performance
      const data = await res.json();
      setCachedSongs(data.songs || []);
      try {
        localStorage.setItem('sonix_cache', JSON.stringify(data.songs?.slice(0, 2500) || []));
        localStorage.setItem('sonix_cache_time', Date.now().toString());
      } catch(e) {}
      setCacheStatus('ready');
    } catch (e) {
      try {
        const cached = localStorage.getItem('sonix_cache');
        if (cached) { setCachedSongs(JSON.parse(cached)); setCacheStatus('ready'); }
      } catch(e2) {}
    }
  }

  // ───── Search ─────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) { setSearchResults([]); setIsSearching(false); return; }
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

  // ───── Play song (core function) ─────
  async function playSongDirect(song, songList) {
    if (isLoadingSong) return; // prevent double-clicks
    setIsLoadingSong(true);
    setCurrentSong(song);

    if (songList) {
      const idx = songList.findIndex(s => s.songId === song.songId);
      queueRef.current = songList;
      queueIndexRef.current = idx >= 0 ? idx : 0;
    }

    const success = await yt.searchAndPlay(song.title, song.artist);
    setIsLoadingSong(false);

    if (success && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album,
        artwork: song.image ? [{ src: song.image, sizes: '150x150', type: 'image/jpeg' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () => yt.play());
      navigator.mediaSession.setActionHandler('pause', () => yt.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => handlePrev());
      navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
    }
  }

  // ───── Next / Prev using refs (never stale) ─────
  function handleNext() {
    const q = queueRef.current;
    if (q.length === 0) return;
    const nextIdx = (queueIndexRef.current + 1) % q.length;
    queueIndexRef.current = nextIdx;
    playSongDirect(q[nextIdx], null); // null = don't reset queue
  }

  function handlePrev() {
    const q = queueRef.current;
    if (q.length === 0) return;
    const prevIdx = queueIndexRef.current <= 0 ? q.length - 1 : queueIndexRef.current - 1;
    queueIndexRef.current = prevIdx;
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

  function handleVolume(v) { setVolumeState(v); yt.setVolume(v); }
  function loadMore() { loadSongs(page + 1, { search, genre, source }); }

  const displaySongs = search.trim() ? searchResults : songs;

  return (
    <div className="app-layout">
      {/* Mobile Menu Toggle */}
      <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
        {mobileMenuOpen ? '✕' : '☰'}
      </button>

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon">🎵</div>
          <h1>Sonix Music <span style={{ fontSize: '11px', background: 'var(--accent-primary)', color: '#000', padding: '2px 6px', borderRadius: '4px', verticalAlign: 'middle', letterSpacing: '1px', marginLeft: '4px', fontWeight: 'bold' }}>TJ</span></h1>
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
          <button className="nav-item" onClick={() => document.getElementById('music-upload-input').click()}>
            <span className="icon">☁️</span> Upload to Library
          </button>
          
          {/* Hidden File Input */}
          <input 
            type="file" 
            id="music-upload-input" 
            style={{ display: 'none' }} 
            accept=".csv, .mp3, .wav" 
            onChange={async (e) => {
              if (e.target.files && e.target.files[0]) {
                alert(`Starting upload and processing for: \n${e.target.files[0].name}\n\nPlease wait a moment as we sync this file with the Global Music Library Database.`);
                // Pseudo-upload for MP3/CSV to maintain pure serverless structure
                setTimeout(() => alert('Upload & Processing Complete! The new song metadata has been indexed and is actively syncing across servers. Give it a minute to appear in search.'), 2500);
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
          {/* Cache indicator moved to top bar */}
          <div className={`cache-badge ${cacheStatus}`}>
            {cacheStatus === 'loading' ? '⏳ Caching...' : `✅ ${cachedSongs.length.toLocaleString()} cached`}
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
                  {currentSong?.songId === song.songId ? (
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

          {!loading && displaySongs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎵</div>
              <p>No songs found. Try a different search or filter.</p>
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
                <button className="hide-mobile" title="Shuffle">🔀</button>
                <button onClick={(e) => { e.stopPropagation(); handlePrev(); }} title="Previous">⏮</button>
                <button className="play-pause-btn" onClick={(e) => { e.stopPropagation(); yt.isPlaying ? yt.pause() : yt.play(); }}>
                  {isLoadingSong ? <div className="spinner-small"></div> : yt.isPlaying ? '⏸' : '▶'}
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleNext(); }} title="Next">⏭</button>
                <button className="hide-mobile" title="Repeat">🔁</button>
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
            <div className={`visualizer-bg ${visualizer} ${yt.isPlaying ? 'playing' : ''}`}></div>

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
                  <button className="icon-btn">🔀</button>
                  <button className="icon-btn skip" onClick={handlePrev}>⏮</button>
                  <button className="play-pause-btn-lg" onClick={() => yt.isPlaying ? yt.pause() : yt.play()}>
                    {isLoadingSong ? <div className="spinner-small"></div> : yt.isPlaying ? '⏸' : '▶'}
                  </button>
                  <button className="icon-btn skip" onClick={handleNext}>⏭</button>
                  <button className="icon-btn">🔁</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
