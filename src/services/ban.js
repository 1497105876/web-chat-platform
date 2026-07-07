const db = require('../db');

async function checkBan(userId, roomId = null) {
  if (!db.isAvailable()) return null;
  let sql = `SELECT * FROM user_bans WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())`;
  const params = [userId];
  if (roomId) {
    sql += ` AND (scope = 'global' OR (scope = 'room' AND room_id = ?))`;
    params.push(roomId);
  } else {
    sql += ` AND scope = 'global'`;
  }
  const [rows] = await db.query(sql, params);
  return rows[0] || null;
}

async function banUser(userId, bannedBy, reason, scope = 'global', roomId = null, expiresAt = null) {
  if (!db.isAvailable()) return null;
  const [result] = await db.query(
    `INSERT INTO user_bans (user_id, banned_by, reason, scope, room_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, bannedBy, reason, scope, roomId, expiresAt]
  );
  if (scope === 'global') {
    await db.query(`UPDATE users SET status = 'banned' WHERE id = ?`, [userId]);
  }
  return result.insertId;
}

async function unbanUser(banId) {
  if (!db.isAvailable()) return;
  const [rows] = await db.query(`SELECT user_id FROM user_bans WHERE id = ?`, [banId]);
  await db.query(`DELETE FROM user_bans WHERE id = ?`, [banId]);
  if (rows[0]) {
    const [remaining] = await db.query(
      `SELECT id FROM user_bans WHERE user_id = ? AND scope = 'global' AND (expires_at IS NULL OR expires_at > NOW())`,
      [rows[0].user_id]
    );
    if (remaining.length === 0) {
      await db.query(`UPDATE users SET status = 'active' WHERE id = ?`, [rows[0].user_id]);
    }
  }
}

module.exports = { checkBan, banUser, unbanUser };
