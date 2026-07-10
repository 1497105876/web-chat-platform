// admin.js — 管理员 REST API 路由
// 提供用户管理、封禁/解封、禁言、踢出、消息删除、审计日志查询等接口
// 权限分层：admin 可管理普通用户，super_admin 可管理角色
const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../auth/middleware');
const banService = require('../services/ban');
const auditService = require('../services/audit');
const router = express.Router();

// 中间件：仅允许 admin 和 super_admin 访问
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

// 中间件：仅允许 super_admin 访问
function superAdminOnly(req, res, next) {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: '需要超级管理员权限' });
  }
  next();
}

// 所有管理员路由先过认证中间件，再过管理员权限检查
router.use(authMiddleware, adminOnly);

// ---- 用户列表（分页+搜索） ----
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

    // 查询总数
    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, params);
    const total = countResult[0].total;

    // 查询分页数据
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

// ---- 修改用户状态（封禁/解封/注销）----
// admin+，不能操作自己，不能操作同级或更高级用户
router.put('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { status } = req.body;

    // 校验状态值
    if (!status || !['active', 'banned', 'deleted'].includes(status)) {
      return res.status(400).json({ error: '无效的状态' });
    }
    // 不能修改自己
    if (userId === req.user.id) {
      return res.status(400).json({ error: '不能修改自己' });
    }

    // 查询目标用户
    const [targets] = await db.query('SELECT id, role FROM users WHERE id = ?', [userId]);
    if (!targets[0]) return res.status(404).json({ error: '用户不存在' });
    const target = targets[0];

    // 权限层级检查：操作者必须比目标用户级别更高
    const HIERARCHY = { super_admin: 3, admin: 2, user: 1 };
    if ((HIERARCHY[req.user.role] || 0) <= (HIERARCHY[target.role] || 0)) {
      return res.status(403).json({ error: '不能操作同级或更高级用户' });
    }

    await db.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    await auditService.log({
      operatorId: req.user.id, action: 'config_change',
      targetType: 'user', targetId: userId,
      detail: { status },
      ipAddress: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('修改用户状态失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- 修改用户角色（仅 super_admin）----
router.put('/users/:id/role', superAdminOnly, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role } = req.body;

    // 只能设置为 user 或 admin，不能设置为 super_admin
    if (!role || !['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: '无效的角色' });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: '不能修改自己的角色' });
    }

    const [targets] = await db.query('SELECT id, role FROM users WHERE id = ?', [userId]);
    if (!targets[0]) return res.status(404).json({ error: '用户不存在' });
    const target = targets[0];

    // 不能修改超级管理员的角色
    if (target.role === 'super_admin') {
      return res.status(400).json({ error: '不能修改超级管理员的角色' });
    }
    // 角色没变化
    if (target.role === role) {
      return res.status(400).json({ error: '用户已经是该角色' });
    }

    await db.query('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
    await auditService.log({
      operatorId: req.user.id, action: 'config_change',
      targetType: 'user', targetId: userId,
      detail: { role },
      ipAddress: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('修改用户角色失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- 封禁用户 ----
router.post('/ban', async (req, res) => {
  try {
    const { userId, reason, expiresAt } = req.body;
    if (!userId || !reason) {
      return res.status(400).json({ error: '用户 ID 和封禁原因不能为空' });
    }
    // 不能封禁自己
    if (userId === req.user.id) {
      return res.status(400).json({ error: '不能封禁自己' });
    }
    const [targets] = await db.query('SELECT id, role FROM users WHERE id = ?', [userId]);
    if (!targets[0]) return res.status(404).json({ error: '用户不存在' });
    // 权限层级检查
    const HIERARCHY = { super_admin: 3, admin: 2, user: 1 };
    if ((HIERARCHY[req.user.role] || 0) <= (HIERARCHY[targets[0].role] || 0)) {
      return res.status(403).json({ error: '不能封禁同级或更高级用户' });
    }

    const banId = await banService.banUser(userId, req.user.id, reason, 'global', null, expiresAt || null);
    await auditService.log({
      operatorId: req.user.id, action: 'ban',
      targetType: 'user', targetId: userId,
      detail: { reason, expiresAt },
      ipAddress: req.ip
    });
    res.json({ ok: true, banId });
  } catch (err) {
    console.error('封禁失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- 解封（按封禁记录 ID）----
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

// ---- 解封（按用户 ID，删除该用户所有全局封禁记录）----
router.delete('/unban-by-user/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    // 查询该用户所有全局封禁记录
    const [bans] = await db.query(
      "SELECT id FROM user_bans WHERE user_id = ? AND scope = 'global'",
      [userId]
    );
    // 逐条解除
    for (const ban of bans) {
      await banService.unbanUser(ban.id);
    }
    // 确保用户状态恢复为活跃
    await db.query("UPDATE users SET status = 'active' WHERE id = ?", [userId]);
    await auditService.log({
      operatorId: req.user.id, action: 'unban',
      targetType: 'user', targetId: userId,
      detail: { removedBans: bans.length },
      ipAddress: req.ip
    });
    res.json({ ok: true, removedBans: bans.length });
  } catch (err) {
    console.error('按用户解封失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- 禁言/解除禁言 ----
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

// ---- 踢出房间 ----
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

// ---- 删除消息（软删除）----
router.delete('/messages/:id', async (req, res) => {
  try {
    const msgId = parseInt(req.params.id);
    await db.query('UPDATE messages SET is_deleted = 1 WHERE id = ?', [msgId]);
    await auditService.log({
      operatorId: req.user.id, action: 'msg_delete',
      targetType: 'message', targetId: msgId,
      ipAddress: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('删除消息失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- 审计日志查询（分页）----
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
