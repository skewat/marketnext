import { useState, useContext } from 'react';
import { Box, Paper, TextField, Typography, Button, Divider, Grid } from '@mui/material';
import { ToastContext } from '../../contexts/ToastContextProvider';

const apiBase = import.meta.env.MODE === 'development' ? '/api' : import.meta.env.VITE_API_BASE_URL;

const Login = () => {
  const { setOpen, setToastPack } = useContext(ToastContext);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const notify = (type: 'success' | 'error' | 'warning' | 'info', message: string) => {
    setToastPack((p) => [...p, { key: Date.now(), type, message }]);
    setOpen(true);
  };

  const doAuth = async (mode: 'login' | 'register') => {
    if (!email && !phone) return notify('error', 'Provide email or phone');
    if (!password) return notify('error', 'Password required');
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || undefined, phone: phone || undefined, password, name: name || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
  localStorage.setItem('authToken', data.token);
  try { const payload = JSON.parse(atob(data.token.split('.')[1])); localStorage.setItem('authUser', JSON.stringify(payload)); } catch {}
      notify('success', mode === 'login' ? 'Logged in' : 'Registered');
    } catch (e: any) {
      notify('error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const googleSignIn = async () => {
    // Minimal Google One Tap / OAuth placeholder — expects an ID token from client flow
    const clientId = (import.meta as any).env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return notify('error', 'Missing VITE_GOOGLE_CLIENT_ID');
    try {
      // In a real app, integrate Google Identity Services to obtain idToken on the client
      // Here we prompt for a token as a quick placeholder
      const idToken = window.prompt('Paste Google ID token');
      if (!idToken) return;
      const res = await fetch(`${apiBase}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Google auth failed');
  localStorage.setItem('authToken', data.token);
  try { const payload = JSON.parse(atob(data.token.split('.')[1])); localStorage.setItem('authUser', JSON.stringify(payload)); } catch {}
      notify('success', 'Logged in with Google');
    } catch (e: any) {
      notify('error', e.message);
    }
  };

  return (
  <Box sx={{ p: { xs: 2, md: 3 }, display: 'flex', justifyContent: 'center', mt: { xs: 6, md: 8 } }}>
      <Paper sx={{ p: 3, maxWidth: 520, width: '100%' }}>
        <Typography variant="h5" sx={{ mb: 2 }}>Login / Register</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField label="Name" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Email" fullWidth value={email} onChange={(e) => setEmail(e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Phone" fullWidth value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Password" type="password" fullWidth value={password} onChange={(e) => setPassword(e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="contained" disabled={loading} onClick={() => doAuth('login')}>Login</Button>
              <Button variant="outlined" disabled={loading} onClick={() => doAuth('register')}>Register</Button>
            </Box>
          </Grid>
          <Grid item xs={12}>
            <Divider>or</Divider>
          </Grid>
          <Grid item xs={12}>
            <Button variant="contained" color="secondary" onClick={googleSignIn}>Sign in with Google</Button>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
};

export default Login;
