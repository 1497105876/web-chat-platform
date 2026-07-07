const express = require('express');
const db = require('../db');
const { hashPassword, comparePassword } = require('../auth/password');
const { signToken, authMiddleware } = require('../auth/middleware');
const audit = require('../services/audit');
const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password, nickname } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (username.length < 2 || username.length > 30) {
      return res.status(400).json({ error: '用户名长度 2-30 字符' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 位' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: '用户名只能包含字母、数字和下划线' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ error: '用户名已被注册' });
    }

    const passwordHash = await hashPassword(password);
    const displayName = nickname || username;
    const [result] = await db.query(
      'INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?)',
      [username, displayName, passwordHash]
    );

    const user = { id: result.insertId, username, nickname: displayName, role: 'user' };
    const token = signToken(user);

    await audit.log({
      operatorId: user.id, action: 'login',
      targetType: 'user', targetId: user.id,
      detail: { event: 'register' },
      ipAddress: req.ip
    });

    res.status(201).json({ token, user: { id: user.id, username, nickname: displayName, role: user.role } });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    if (user.status === 'banned') {
      return res.status(403).json({ error: '你的账号已被封禁' });
    }
    if (user.status === 'deleted') {
      return res.status(403).json({ error: '账号已注销' });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    const token = signToken(user);

    await audit.log({
      operatorId: user.id, action: 'login',
      targetType: 'user', targetId: user.id,
      detail: { event: 'login' },
      ipAddress: req.ip
    });

    res.json({
      token,
      user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role, avatar_url: user.avatar_url }
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await audit.log({
      operatorId: req.user.id, action: 'logout',
      targetType: 'user', targetId: req.user.id,
      ipAddress: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, nickname, avatar_url, role, status, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: '用户不存在' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
