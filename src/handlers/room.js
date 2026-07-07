const conn = require('./connection');
const db = require('../db');
const messageService = require('../services/message');
const banService = require('../services/ban');

async function handleJoin(ws, data, req) {
  const meta = conn.getConnMeta(ws);
  const channel = (data.channel || '').trim();

  if (!channel) {
    ws.send(JSON.stringify({ type: 'error', message: '频道名不能为空' }));
    return;
  }

  if (meta.channel) {
    ws.send(JSON.stringify({ type: 'error', message: '已加入频道，请先离开' }));
    return;
  }

  if (db.isAvailable()) {
    const banned = await banService.checkBan(meta.userId);
    if (banned) {
      ws.send(JSON.stringify({ type: 'error', message: `你的账号已被封禁，原因: ${banned.reason}` }));
      return;
    }

    const [rooms] = await db.query('SELECT id, name FROM rooms WHERE name = ? AND status = ?', [channel, 'active']);
    if (rooms.length === 0) {
      ws.send(JSON.stringify({ type: 'error', message: '频道不存在' }));
      return;
    }
    const roomId = rooms[0].id;

    const [members] = await db.query(
      'SELECT id FROM room_members WHERE room_id = ? AND user_id = ?',
      [roomId, meta.userId]
    );
    if (members.length === 0) {
      await db.query(
        'INSERT INTO room_members (room_id, user_id) VALUES (?, ?)',
        [roomId, meta.userId]
      );
    }

    meta.roomId = roomId;
  }

  meta.channel = channel;
  conn.joinChannel(ws, channel);

  console.log(`[JOIN] user=${meta.username}, channel=${channel}, ip=${req.socket?.remoteAddress}`);

  const history = await messageService.loadRecentMessages(meta.roomId || channel);
  ws.send(JSON.stringify({ type: 'history', channel, messages: history }));

  conn.broadcastToChannel(channel, {
    type: 'system',
    channel,
    message: `${meta.username} 加入了 ${channel}`,
    createdAt: new Date().toISOString()
  });
  conn.sendUserList(channel);
}

function handleLeave(ws) {
  const meta = conn.getConnMeta(ws);
  if (!meta?.channel) return;

  conn.leaveChannel(ws, meta.channel);
  conn.broadcastToChannel(meta.channel, {
    type: 'system',
    channel: meta.channel,
    message: `${meta.username || '有人'} 离开了 ${meta.channel}`,
    createdAt: new Date().toISOString()
  });
  conn.sendUserList(meta.channel);

  console.log(`[LEAVE] user=${meta.username}, channel=${meta.channel}`);
  meta.channel = null;
  meta.roomId = null;
}

module.exports = { handleJoin, handleLeave };
