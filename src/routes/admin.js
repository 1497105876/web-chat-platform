const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../auth/middleware');
const banService = require('../services/ban');
const auditService = require('../services/audit');
const router = express.Router();

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

router.use(authMiddleware, adminOnly);

router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize) || 50);
    const search = req.query.search || '';
    const offset = (page - 1) * pageSize;

    let where = '1=1';
    const params = [];
    if (search) {
      where += ' AND (username LIKE ? OR nickname LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, params);
    const total = countResult[0].total;

    const [users] = await db.query(
      `SELECT id, username, nickname, role, status, last_login_at, created_at
       FROM users WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({ users, total, page, pageSize });
  } catch (err) {
    console.error('获取用户列表失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role, status } = req.body;
    if (role && !['user', 'admin', 'super_admin'].includes(role)) {
      return res.status(400).json({ error: '无效的角色' });
    }
    if (status && !['active', 'banned', 'deleted'].includes(status)) {
      return res.status(400).json({ error: '无效的状态' });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: '不能修改自己的角色' });
    }

    const updates = [];
    const params = [];
    if (role) { updates.push('role = ?'); params.push(role); }
    if (status) { updates.push('status = ?'); params.push(status); }
    if (updates.length === 0) return res.status(400).json({ error: '无更新内容' });

    params.push(userId);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    await auditService.log({
      operatorId: req.user.id, action: 'config_change',
      targetType: 'user', targetId: userId,
      detail: { role, status },
      ipAddress: req.ip
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('修改用户失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/ban', async (req, res) => {
  try {
    const { userId, reason, scope, roomId, expiresAt } = req.body;
    if (!userId || !reason) {
      return res.status(400).json({ error: '用户 ID 和封禁原因不能为空' });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: '不能封禁自己' });
    }
    const banId = await banService.banUser(userId, req.user.id, reason, scope || 'global', roomId || null, expiresAt || null);
    await auditService.log({
      operatorId: req.user.id, action: 'ban',
      targetType: 'user', targetId: userId,
      detail: { reason, scope, roomId, expiresAt },
      ipAddress: req.ip
    });
    res.json({ ok: true, banId });
  } catch (err) {
    console.error('封禁失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.delete('/ban/:id', async (req, res) => {
  try {
    const banId = parseInt(req.params.id);
    await banService.unbanUser(banId);
    await auditService.log({
      operatorId: req.user.id, action: 'unban',
      targetType: 'user', targetId: banId,
      ipAddress: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('解封失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/room/:id/mute', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const { userId, muted } = req.body;
    if (!userId) return res.status(400).json({ error: '用户 ID 不能为空' });
    await db.query(
      'UPDATE room_members SET is_muted = ? WHERE room_id = ? AND user_id = ?',
      [muted ? 1 : 0, roomId, userId]
    );
    await auditService.log({
      operatorId: req.user.id, action: muted ? 'mute' : 'unmute',
      targetType: 'user', targetId: userId,
      detail: { roomId },
      ipAddress: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('禁言操作失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.delete('/room/:id/kick', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: '用户 ID 不能为空' });
    await db.query('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);
    await auditService.log({
      operatorId: req.user.id, action: 'kick',
      targetType: 'user', targetId: userId,
      detail: { roomId },
      ipAddress: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('踢出失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize) || 50);
    const action = req.query.action || null;
    const logs = await auditService.getLogs({ page, pageSize, action });
    res.json({ logs, page, pageSize });
  } catch (err) {
    console.error('获取审计日志失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
