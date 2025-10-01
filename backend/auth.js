import express from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { createUser, findUserByEmailOrPhone, verifyPassword, upsertOAuthUser } from './userStore.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';

const signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

router.post('/register', async (req, res) => {
  try {
    const { email, phone, password, name } = req.body;
    if ((!email && !phone) || !password) return res.status(400).json({ error: 'Email or phone and password required' });
    const user = await createUser({ email, phone, password, name });
    const token = signToken({ sub: user.id, email: user.email, phone: user.phone, name: user.name });
    res.json({ user, token });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    const user = findUserByEmailOrPhone(email, phone);
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken({ sub: user.id, email: user.email, phone: user.phone, name: user.name });
    res.json({ user: { id: user.id, email: user.email, phone: user.phone, provider: user.provider, name: user.name }, token });
  } catch (e) {
    res.status(400).json({ error: 'Login failed' });
  }
});

router.get('/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ user: payload });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { idToken, clientId } = req.body;
    if (!idToken || !clientId) return res.status(400).json({ error: 'idToken and clientId required' });
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    const email = payload?.email;
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const displayName = payload?.name || null;
    const user = upsertOAuthUser({ email, provider: 'google', providerId: payload?.sub, name: displayName });
    const token = signToken({ sub: user.id, email: user.email, name: user.name });
    res.json({ user, token });
  } catch (e) {
    res.status(400).json({ error: 'Google auth failed' });
  }
});

export default router;
