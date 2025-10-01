import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const dataFile = path.join(process.cwd(), 'backend', 'users.json');

const readUsers = () => {
  try {
    if (!fs.existsSync(dataFile)) return [];
    const raw = fs.readFileSync(dataFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const writeUsers = (users) => {
  const dir = path.dirname(dataFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(users, null, 2));
};

export const findUserByEmailOrPhone = (email, phone) => {
  const users = readUsers();
  return users.find((u) => (email && u.email === email) || (phone && u.phone === phone));
};

export const createUser = async ({ email, phone, password, name }) => {
  const users = readUsers();
  const exists = users.find((u) => (email && u.email === email) || (phone && u.phone === phone));
  if (exists) throw new Error('User already exists');

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const user = {
    id: Date.now().toString(36),
    email: email || null,
    phone: phone || null,
    passwordHash,
    provider: 'local',
    name: name || null,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);
  return { id: user.id, email: user.email, phone: user.phone, provider: user.provider, name: user.name };
};

export const verifyPassword = async (password, passwordHash) => {
  return bcrypt.compare(password, passwordHash);
};

export const upsertOAuthUser = ({ email, provider, providerId, name }) => {
  const users = readUsers();
  let user = users.find((u) => u.email === email);
  if (!user) {
    user = {
      id: Date.now().toString(36),
      email,
      phone: null,
      passwordHash: null,
      provider,
      providerId,
      name: name || null,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);
  }
  return { id: user.id, email: user.email, phone: user.phone, provider: user.provider, name: user.name };
};
