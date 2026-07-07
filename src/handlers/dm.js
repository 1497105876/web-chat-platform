const conn = require('./connection');
const db = require('../db');
const messageService = require('../services/message');

function getDmRoomId(userId1, userId2) {
  const [a, b] = [userId1, userId2].sort((x, y) => x - y);
  return `dm_${a}_${b}`;
}

async function handleDm(ws, data, req) {
  const meta = conn.getConnMeta(ws);
  const targetUserId = data.targetUserId;

  if (!targetUserId) {
    ws.send(JSON.stringify({ type: 'error', message: '目标用户 ID 不能为空' }));
    return;
  }
  if (targetUserId === meta.userId) {
    ws.send(JSON.stringify({ type: 'error', message: '不能和自己私聊' }));
    return;
  }

  if (!db.isAvailable()) {
    ws.send(JSON.stringify({ type: 'error', message: '数据库不可用' }));
    return;
  }

  const [targetUsers] = await db.query('SELECT id, username, nickname FROM users WHERE id = ? AND status = ?', [targetUserId, 'active']);
  if (targetUsers.length === 0) {
    ws.send(JSON.stringify({ type: 'error', message: '目标用户不存在' }));
    return;
  }

  const dmName = getDmRoomId(meta.userId, targetUserId);

  let [rooms] = await db.query('SELECT id FROM rooms WHERE name = ?', [dmName]);
  let roomId;
  if (rooms.length === 0) {
    const [result] = await db.query(
      `INSERT INTO rooms (name, display_name, type, max_members) VALUES (?, ?, 'dm', 2)`,
      [dmName, `私聊`]
    );
    roomId = result.insertId;
    await db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?), (?, ?)',
      [roomId, meta.userId, roomId, targetUserId]);
  } else {
    roomId = rooms[0].id;
    const [members] = await db.query('SELECT id FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, meta.userId]);
    if (members.length === 0) {
      await db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [roomId, meta.userId]);
    }
  }

  ws.send(JSON.stringify({
    type: 'dm:open',
    roomId,
    channel: dmName,
    targetUser: targetUsers[0]
  }));
}

module.exports = { handleDm };
