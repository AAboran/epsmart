'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('./db');

// IMPORTANT on Vercel: set EUROPA_JWT_SECRET so tokens stay valid across the
// many serverless instances and cold starts. Without it each instance would
// generate its own secret and users would be logged out unpredictably.
const SECRET = process.env.EUROPA_JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = '12h';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    SECRET, { expiresIn: TOKEN_TTL }
  );
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

async function currentUser(req) {
  let token = req.cookies && req.cookies.token;
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    const { rows } = await query('SELECT id, username, name, role, active FROM users WHERE id=$1', [payload.id]);
    const user = rows[0];
    if (!user || !user.active) return null;
    return user;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to continue.' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}

module.exports = { signToken, verifyPassword, currentUser, requireAuth, requireRole, SECRET };
