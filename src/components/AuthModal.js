'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/authContext';

export default function AuthModal({ onClose }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register(form.name, form.email, form.password);
      }
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <button style={styles.close} onClick={onClose}>✕</button>
        <h2 style={styles.title}>
          {mode === 'login' ? 'Log in to Sonix' : 'Create account'}
        </h2>

        <form onSubmit={handleSubmit} style={styles.form}>
          {mode === 'register' && (
            <input
              style={styles.input}
              type="text"
              placeholder="Your name"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
            />
          )}
          <input
            style={styles.input}
            type="email"
            placeholder="Email address"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            required
            minLength={6}
          />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>
        </form>

        <p style={styles.toggle}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <span style={styles.link} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </span>
        </p>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 },
  modal: { background: '#181818', borderRadius: 16, padding: '40px 32px', width: '100%', maxWidth: 400, position: 'relative', color: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' },
  close: { position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' },
  title: { textAlign: 'center', marginBottom: 24, fontSize: 24, fontWeight: 700 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: { padding: '12px 16px', borderRadius: 8, border: '1px solid #333', background: '#242424', color: '#fff', fontSize: 14, outline: 'none' },
  btn: { padding: '13px', borderRadius: 24, background: '#1db954', color: '#000', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer', marginTop: 8 },
  error: { color: '#ff4444', fontSize: 13, textAlign: 'center', padding: '4px 0' },
  toggle: { textAlign: 'center', marginTop: 20, color: '#aaa', fontSize: 14 },
  link: { color: '#1db954', cursor: 'pointer', fontWeight: 600 },
};
