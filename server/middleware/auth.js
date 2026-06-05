import jwt from 'jsonwebtoken';

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  return s;
};

export function signToken(userId) {
  return jwt.sign({ sub: userId }, secret(), { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  try {
    const decoded = jwt.verify(header.slice(7), secret());
    req.userId = decoded.sub;
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.slice(7), secret());
      req.userId = decoded.sub;
    } catch { /* ignore — unauthenticated is fine */ }
  }
  next();
}
