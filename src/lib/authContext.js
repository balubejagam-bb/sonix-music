'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [likedSongs, setLikedSongs] = useState(new Set());
  const [userPlaylists, setUserPlaylists] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('sonix_token');
    if (token) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
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
      const res = await fetch('/api/user/liked', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setLikedSongs(new Set(data.likedSongs || []));
    } catch {}
  };

  const fetchUserPlaylists = async (token) => {
    try {
      const res = await fetch('/api/playlist', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setUserPlaylists(data.playlists || []);
    } catch {}
  };

  const toggleLike = useCallback(async (songId) => {
    const token = localStorage.getItem('sonix_token');
    if (!token) return false;
    const isLiked = likedSongs.has(songId);
    // Optimistic update
    setLikedSongs(prev => {
      const next = new Set(prev);
      isLiked ? next.delete(songId) : next.add(songId);
      return next;
    });
    try {
      await fetch(`/api/user/like/${songId}`, {
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
    }
    return !isLiked;
  }, [likedSongs]);

  const createPlaylist = useCallback(async (name) => {
    const token = localStorage.getItem('sonix_token');
    if (!token) return null;
    const res = await fetch('/api/playlist', {
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
      const res = await fetch(`/api/playlist/${playlistId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'add', songId }),
      });
      return res.ok;
    } catch { return false; }
  }, []);

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
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
    const res = await fetch('/api/auth/register', {
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
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('sonix_token');
    setUser(null);
    setLikedSongs(new Set());
    setUserPlaylists([]);
  };

  const getToken = () => localStorage.getItem('sonix_token');

  return (
    <AuthContext.Provider value={{
      user, loading, login, register, logout, getToken,
      likedSongs, toggleLike, userPlaylists, createPlaylist, addSongToPlaylist,
      refreshPlaylists: () => fetchUserPlaylists(getToken()),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
