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
    const nextForm = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
    };
    if (!nextForm.email || !nextForm.password || (mode === 'register' && !nextForm.name)) {
      setError('Please fill in all required fields.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(nextForm.email, nextForm.password);
      } else {
        await register(nextForm.name, nextForm.email, nextForm.password);
      }
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <button style={styles.close} type="button" onClick={onClose} aria-label="Close auth dialog">✕</button>
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
            autoComplete="email"
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
          />
          {error && <p style={styles.error} role="alert">{error}</p>}
          <button style={{ ...styles.btn, opacity: loading ? 0.72 : 1 }} type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>
        </form>

        <p style={styles.toggle}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            style={styles.link}
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(3,5,18,0.82)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: 20 },
  modal: { background: 'linear-gradient(180deg, rgba(24,24,38,0.98), rgba(12,12,24,0.98))', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '40px 32px', width: '100%', maxWidth: 420, position: 'relative', color: '#fff', boxShadow: '0 24px 80px rgba(0,0,0,0.75)' },
  close: { position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: 17, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1', fontSize: 18, cursor: 'pointer' },
  title: { textAlign: 'center', marginBottom: 24, fontSize: 24, fontWeight: 700 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: { padding: '12px 16px', borderRadius: 8, border: '1px solid #333', background: '#242424', color: '#fff', fontSize: 14, outline: 'none' },
  btn: { padding: '13px', borderRadius: 24, background: '#1db954', color: '#000', fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer', marginTop: 8 },
  error: { color: '#fecaca', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(248,113,113,0.22)', borderRadius: 10, fontSize: 13, textAlign: 'center', padding: '9px 10px' },
  toggle: { textAlign: 'center', marginTop: 20, color: '#aaa', fontSize: 14 },
  link: { color: '#1db954', cursor: 'pointer', fontWeight: 700, background: 'none', border: 'none', padding: 0, font: 'inherit' },
};
