// ban.js — 用户封禁服务
// 负责检查封禁状态、执行封禁、解除封禁
// 封禁支持全局和房间级两种范围，可选过期时间
const db = require('../db');

// 检查用户是否被封禁
// roomId 不传时只检查全局封禁，传了则同时检查房间级封禁
// 返回封禁记录对象或 null（未被封禁）
async function checkBan(userId, roomId = null) {
  if (!db.isAvailable()) return null;
  let sql = `SELECT * FROM user_bans WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())`;
  const params = [userId];
  if (roomId) {
    // 房间级检查：全局封禁或该房间的封禁都算
    sql += ` AND (scope = 'global' OR (scope = 'room' AND room_id = ?))`;
    params.push(roomId);
  } else {
    // 仅检查全局封禁
    sql += ` AND scope = 'global'`;
  }
  const [rows] = await db.query(sql, params);
  return rows[0] || null;
}

// 封禁用户
// scope: 'global' 全局封禁，'room' 仅在特定房间封禁
// 全局封禁时同时更新用户表状态为 banned
async function banUser(userId, bannedBy, reason, scope = 'global', roomId = null, expiresAt = null) {
  if (!db.isAvailable()) return null;
  const [result] = await db.query(
    `INSERT INTO user_bans (user_id, banned_by, reason, scope, room_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, bannedBy, reason, scope, roomId, expiresAt]
  );
  // 全局封禁时同步更新用户状态
  if (scope === 'global') {
    await db.query(`UPDATE users SET status = 'banned' WHERE id = ?`, [userId]);
  }
  return result.insertId;
}

// 解除封禁
// 删除封禁记录后，检查该用户是否还有其他全局封禁，没有则恢复用户状态为 active
async function unbanUser(banId) {
  if (!db.isAvailable()) return;
  // 先查出被封禁的用户 ID
  const [rows] = await db.query(`SELECT user_id FROM user_bans WHERE id = ?`, [banId]);
  // 删除封禁记录
  await db.query(`DELETE FROM user_bans WHERE id = ?`, [banId]);
  if (rows[0]) {
    // 检查是否还有其他有效的全局封禁记录
    const [remaining] = await db.query(
      `SELECT id FROM user_bans WHERE user_id = ? AND scope = 'global' AND (expires_at IS NULL OR expires_at > NOW())`,
      [rows[0].user_id]
    );
    // 没有其他封禁则恢复用户状态
    if (remaining.length === 0) {
      await db.query(`UPDATE users SET status = 'active' WHERE id = ?`, [rows[0].user_id]);
    }
  }
}

module.exports = { checkBan, banUser, unbanUser };
