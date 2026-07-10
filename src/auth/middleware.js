// middleware.js — JWT 认证中间件
// 负责：签发 JWT token、验证 token、Express 路由鉴权中间件
const jwt = require('jsonwebtoken');
// 密钥从环境变量读取，开发环境使用默认值
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// 签发 JWT token，载荷包含用户 ID、用户名、角色
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// 验证 JWT token，成功返回载荷对象，失败返回 null
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Express 中间件：从 Authorization 头提取 Bearer token 并验证
// 验证通过后将用户信息挂到 req.user 上，供后续路由使用
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  // 必须是 Bearer 格式
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }
  // 去掉 "Bearer " 前缀，提取实际 token
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'token 无效或已过期' });
  }
  req.user = payload;
  next();
}

module.exports = { signToken, verifyToken, authMiddleware, JWT_SECRET };
