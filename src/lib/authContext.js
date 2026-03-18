'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

const AuthContext = createContext(null);

function resolveApiBase() {
  const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  if (nativeAndroid) return 'https://sonix-music.vercel.app';
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

function apiPath(path) {
  if (typeof path !== 'string') return path;

  const localApiMatch = path.match(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/api\/.*)$/i);
  if (localApiMatch) {
    path = localApiMatch[1];
  }

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [likedSongs, setLikedSongs] = useState(new Set());
  const [likedSongObjects, setLikedSongObjects] = useState([]); // full song objects for liked songs
  const [userPlaylists, setUserPlaylists] = useState([]);

  useEffect(() => {
    try {
      const likedCache = localStorage.getItem('sonix_liked_ids');
      const playlistsCache = localStorage.getItem('sonix_user_playlists');
      const likedObjects = localStorage.getItem('sonix_liked_objects');
      if (likedCache) setLikedSongs(new Set(JSON.parse(likedCache)));
      if (playlistsCache) setUserPlaylists(JSON.parse(playlistsCache));
      if (likedObjects) setLikedSongObjects(JSON.parse(likedObjects));
    } catch {}

    const token = localStorage.getItem('sonix_token');
    if (token) {
      fetch(apiPath('/api/auth/me'), { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          if (data.user) {
            setUser(data.user);
            fetchLikedSongs(token);
            fetchUserPlaylists(token);
          } else {
            localStorage.removeItem('sonix_token');
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const fetchLikedSongs = async (token) => {
    try {
      const res = await fetch(apiPath('/api/user/liked'), { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setLikedSongs(new Set(data.likedSongs || []));
      try { localStorage.setItem('sonix_liked_ids', JSON.stringify(data.likedSongs || [])); } catch {}
      // Also restore full song objects from localStorage if available
      try {
        const saved = localStorage.getItem('sonix_liked_objects');
        if (saved) setLikedSongObjects(JSON.parse(saved));
      } catch {}
    } catch {}
  };

  const fetchUserPlaylists = async (token) => {
    try {
      const res = await fetch(apiPath('/api/playlist'), { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setUserPlaylists(data.playlists || []);
      try { localStorage.setItem('sonix_user_playlists', JSON.stringify(data.playlists || [])); } catch {}
    } catch {}
  };

  const toggleLike = useCallback(async (songId, songObject = null) => {
    const token = localStorage.getItem('sonix_token');
    if (!token) return false;
    const isLiked = likedSongs.has(songId);
    // Optimistic update for ID set
    setLikedSongs(prev => {
      const next = new Set(prev);
      isLiked ? next.delete(songId) : next.add(songId);
      return next;
    });
    // Optimistic update for song objects (so YT songs appear in liked list)
    if (songObject) {
      setLikedSongObjects(prev => {
        const next = isLiked
          ? prev.filter(s => (s.songId || s._id || s.videoId || `${s.title}::${s.artist}`) !== songId)
          : [songObject, ...prev.filter(s => (s.songId || s._id || s.videoId || `${s.title}::${s.artist}`) !== songId)];
        try { localStorage.setItem('sonix_liked_objects', JSON.stringify(next)); } catch {}
        return next;
      });
    }
    try {
      await fetch(apiPath(`/api/user/like/${encodeURIComponent(songId)}`), {
        method: isLiked ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Revert on error
      setLikedSongs(prev => {
        const next = new Set(prev);
        isLiked ? next.add(songId) : next.delete(songId);
        return next;
      });
      if (songObject) {
        setLikedSongObjects(prev => {
          const next = isLiked
            ? [songObject, ...prev.filter(s => (s.songId || s._id || s.videoId || `${s.title}::${s.artist}`) !== songId)]
            : prev.filter(s => (s.songId || s._id || s.videoId || `${s.title}::${s.artist}`) !== songId);
          try { localStorage.setItem('sonix_liked_objects', JSON.stringify(next)); } catch {}
          return next;
        });
      }
    }
    return !isLiked;
  }, [likedSongs]);

  const createPlaylist = useCallback(async (name) => {
    const token = localStorage.getItem('sonix_token');
    if (!token) return null;
    const res = await fetch(apiPath('/api/playlist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.playlist) {
      // Immediately reflect in state
      setUserPlaylists(prev => [...prev, data.playlist]);
      return data.playlist;
    }
    return null;
  }, []);

  const addSongToPlaylist = useCallback(async (playlistId, songId) => {
    const token = localStorage.getItem('sonix_token');
    if (!token) return false;
    try {
      const res = await fetch(apiPath(`/api/playlist/${playlistId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'add', songId }),
      });
      return res.ok;
    } catch { return false; }
  }, []);

  const login = async (email, password) => {
    const res = await fetch(apiPath('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('sonix_token', data.token);
    setUser(data.user);
    fetchLikedSongs(data.token);
    fetchUserPlaylists(data.token);
    return data;
  };

  const register = async (name, email, password) => {
    const res = await fetch(apiPath('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    localStorage.setItem('sonix_token', data.token);
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    await fetch(apiPath('/api/auth/logout'), { method: 'POST' });
    localStorage.removeItem('sonix_token');
    localStorage.removeItem('sonix_liked_objects');
    localStorage.removeItem('sonix_liked_ids');
    localStorage.removeItem('sonix_user_playlists');
    setUser(null);
    setLikedSongs(new Set());
    setLikedSongObjects([]);
    setUserPlaylists([]);
  };

  const getToken = () => localStorage.getItem('sonix_token');

  return (
    <AuthContext.Provider value={{
      user, loading, login, register, logout, getToken,
      likedSongs, likedSongObjects, toggleLike, userPlaylists, createPlaylist, addSongToPlaylist,
      refreshPlaylists: () => fetchUserPlaylists(getToken()),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
