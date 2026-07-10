// audit.js — 审计日志服务
// 记录管理员操作日志，提供日志查询接口
// 用于安全审计和操作追溯
const db = require('../db');

// 写入一条审计日志
// operatorId: 操作者 ID
// action: 操作类型（login/logout/kick/ban/unban/mute/unmute/room_create/room_delete/msg_delete/config_change）
// targetType: 操作目标类型（user/room/message）
// targetId: 操作目标 ID
// detail: 操作详情（JSON 对象）
// ipAddress: 操作者 IP 地址
async function log({ operatorId, action, targetType = null, targetId = null, detail = null, ipAddress }) {
  if (!db.isAvailable()) return;
  await db.query(
    `INSERT INTO audit_logs (operator_id, action, target_type, target_id, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?)`,
    [operatorId, action, targetType, targetId, detail ? JSON.stringify(detail) : null, ipAddress]
  );
}

// 分页查询审计日志，支持按操作类型和操作者筛选
async function getLogs({ page = 1, pageSize = 50, action = null, operatorId = null } = {}) {
  if (!db.isAvailable()) return [];
  let where = '1=1';
  const params = [];
  // 按操作类型筛选
  if (action) { where += ' AND a.action = ?'; params.push(action); }
  // 按操作者筛选
  if (operatorId) { where += ' AND a.operator_id = ?'; params.push(operatorId); }
  const offset = (page - 1) * pageSize;
  // 关联用户表获取操作者用户名
  const [rows] = await db.query(
    `SELECT a.*, u.username AS operator_name
     FROM audit_logs a
     LEFT JOIN users u ON a.operator_id = u.id
     WHERE ${where}
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  return rows;
}

module.exports = { log, getLogs };
