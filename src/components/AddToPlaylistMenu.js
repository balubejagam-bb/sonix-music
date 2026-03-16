'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/authContext';

export default function AddToPlaylistMenu({ song, onClose }) {
  const { userPlaylists, createPlaylist, addSongToPlaylist, toggleLike, likedSongs, refreshPlaylists } = useAuth();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [added, setAdded] = useState(null);

  const songId = song?.songId || song?._id || song?.videoId || `${song?.title}::${song?.artist}`;
  const isLiked = likedSongs.has(songId);

  async function handleAddToPlaylist(pl) {
    await addSongToPlaylist(pl._id, songId);
    setAdded(pl._id);
    refreshPlaylists(); // sync song count in sidebar
    setTimeout(onClose, 700);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    const pl = await createPlaylist(newName.trim());
    if (pl) await addSongToPlaylist(pl._id, songId);
    setCreating(false);
    setAdded('new');
    refreshPlaylists();
    setTimeout(onClose, 700);
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.menu} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.songName}>{song?.title}</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Like toggle */}
        <button style={{ ...s.likeBtn, color: isLiked ? '#1db954' : '#aaa' }}
          onClick={() => { toggleLike(songId); onClose(); }}>
          {isLiked ? '💚 Remove from Liked Songs' : '🤍 Add to Liked Songs'}
        </button>

        <div style={s.divider} />
        <div style={s.label}>Add to playlist</div>

        {/* Liked Songs playlist shortcut */}
        <button style={s.plItem} onClick={() => { toggleLike(songId); onClose(); }}>
          <span style={s.plIcon}>💚</span>
          <span>Liked Songs</span>
          {isLiked && <span style={s.check}>✓</span>}
        </button>

        {/* User playlists */}
        {userPlaylists.map(pl => (
          <button key={pl._id} style={s.plItem} onClick={() => handleAddToPlaylist(pl)}>
            <span style={s.plIcon}>🎵</span>
            <span>{pl.name}</span>
            {added === pl._id && <span style={s.check}>✓ Added</span>}
          </button>
        ))}

        {/* Create new */}
        <div style={s.createRow}>
          <input
            style={s.input}
            placeholder="New playlist name..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <button style={s.createBtn} onClick={handleCreate} disabled={creating || !newName.trim()}>
            {creating ? '...' : added === 'new' ? '✓' : '+'}
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.5)' },
  menu: { position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', width: '90%', maxWidth: 360, background: '#1a1a2e', borderRadius: 16, padding: '16px 0 8px', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.08)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  songName: { color: '#fff', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 },
  closeBtn: { background: 'none', border: 'none', color: '#aaa', fontSize: 16, cursor: 'pointer', flexShrink: 0 },
  likeBtn: { display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', fontWeight: 600 },
  divider: { height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' },
  label: { padding: '8px 16px 4px', color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  plItem: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', background: 'none', border: 'none', color: '#e5e7eb', fontSize: 14, cursor: 'pointer', textAlign: 'left' },
  plIcon: { fontSize: 18, flexShrink: 0 },
  check: { marginLeft: 'auto', color: '#1db954', fontSize: 13, fontWeight: 700 },
  createRow: { display: 'flex', gap: 8, padding: '10px 16px 4px' },
  input: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#0d0d1a', color: '#fff', fontSize: 13, outline: 'none' },
  createBtn: { padding: '8px 14px', borderRadius: 8, background: '#7c3aed', color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: 'pointer' },
};
