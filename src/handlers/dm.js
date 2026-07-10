// dm.js — 私信（Direct Message）处理器
// 处理用户发起私聊的请求：创建/复用私聊房间、注册成员关系
const conn = require('./connection');
const db = require('../db');
const WebSocket = require('ws');

// 生成私聊房间的唯一标识名：两个用户 ID 排序后拼接，保证两人总是对应同一个房间名
function getDmRoomId(userId1, userId2) {
  const [a, b] = [userId1, userId2].sort((x, y) => x - y);
  return `dm_${a}_${b}`;
}

// 处理私聊请求
async function handleDm(ws, data, req) {
  const meta = conn.getConnMeta(ws);
  const targetUserId = data.targetUserId;

  // 目标用户 ID 不能为空
  if (!targetUserId) {
    ws.send(JSON.stringify({ type: 'error', message: '目标用户 ID 不能为空' }));
    return;
  }
  // 不允许和自己私聊
  if (targetUserId === meta.userId) {
    ws.send(JSON.stringify({ type: 'error', message: '不能和自己私聊' }));
    return;
  }

  // 私聊功能依赖数据库
  if (!db.isAvailable()) {
    ws.send(JSON.stringify({ type: 'error', message: '数据库不可用' }));
    return;
  }

  // 验证目标用户存在且状态为活跃
  const [targetUsers] = await db.query('SELECT id, username, nickname FROM users WHERE id = ? AND status = ?', [targetUserId, 'active']);
  if (targetUsers.length === 0) {
    ws.send(JSON.stringify({ type: 'error', message: '目标用户不存在' }));
    return;
  }

  // 生成私聊房间名
  const dmName = getDmRoomId(meta.userId, targetUserId);

  // 查找是否已有该私聊房间
  let [rooms] = await db.query('SELECT id FROM rooms WHERE name = ?', [dmName]);
  let roomId;
  if (rooms.length === 0) {
    // 首次私聊：创建房间和双方成员记录
    const [result] = await db.query(
      `INSERT INTO rooms (name, display_name, type, max_members) VALUES (?, ?, 'dm', 2)`,
      [dmName, `私聊`]
    );
    roomId = result.insertId;
    await db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?), (?, ?)',
      [roomId, meta.userId, roomId, targetUserId]);
  } else {
    // 房间已存在：确保当前用户在成员列表中
    roomId = rooms[0].id;
    const [members] = await db.query('SELECT id FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, meta.userId]);
    if (members.length === 0) {
      await db.query('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', [roomId, meta.userId]);
    }
  }

  // 查询发起者的用户信息（用于通知对方）
  const [myInfo] = await db.query('SELECT id, username, nickname FROM users WHERE id = ?', [meta.userId]);

  // 返回私聊房间信息给发起者
  ws.send(JSON.stringify({
    type: 'dm:open',
    roomId,
    channel: dmName,
    targetUser: targetUsers[0],
    initiator: true
  }));

  // 如果对方也在线，给对方也发 dm:open，让对方私聊列表自动出现这个会话
  for (const [client, clientMeta] of conn.connectionMeta) {
    if (clientMeta.userId === targetUserId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'dm:open',
        roomId,
        channel: dmName,
        targetUser: myInfo[0],
        initiator: false
      }));
      break;
    }
  }
}

module.exports = { handleDm };
