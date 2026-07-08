const conn = require('./connection');
const db = require('../db');
const banService = require('../services/ban');
const auditService = require('../services/audit');

async function handleAdmin(ws, data, meta, req) {
  const action = data.type;

  if (action === 'admin:kick') {
    const { userId, roomId } = data;
    if (!userId || !roomId) {
      ws.send(JSON.stringify({ type: 'error', message: '参数不完整' }));
      return;
    }
    await db.query('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);
    await auditService.log({
      operatorId: meta.userId, action: 'kick',
      targetType: 'user', targetId: userId,
      detail: { roomId }, ipAddress: req.socket?.remoteAddress || req.ip || 'unknown'
    });

    for (const [client, clientMeta] of conn.connectionMeta) {
      if (clientMeta.userId === userId && clientMeta.roomId === roomId) {
        client.send(JSON.stringify({ type: 'kicked', message: '你已被管理员踢出该房间' }));
        client.close(4002, '被踢出');
      }
    }

    const [room] = await db.query('SELECT name FROM rooms WHERE id = ?', [roomId]);
    if (room[0]) conn.sendUserList(room[0].name);
    ws.send(JSON.stringify({ type: 'admin:ok', action: 'kick' }));
  }

  else if (action === 'admin:ban') {
    const { userId, reason, expiresAt } = data;
    if (!userId || !reason) {
      ws.send(JSON.stringify({ type: 'error', message: '用户 ID 和封禁原因不能为空' }));
      return;
    }
    await banService.banUser(userId, meta.userId, reason, 'global', null, expiresAt || null);
    await auditService.log({
      operatorId: meta.userId, action: 'ban',
      targetType: 'user', targetId: userId,
      detail: { reason, expiresAt }, ipAddress: req.socket?.remoteAddress || req.ip || 'unknown'
    });

    for (const [client, clientMeta] of conn.connectionMeta) {
      if (clientMeta.userId === userId) {
        client.send(JSON.stringify({ type: 'banned', message: `你已被封禁，原因: ${reason}`, expiresAt }));
        client.close(4003, '被封禁');
      }
    }
    ws.send(JSON.stringify({ type: 'admin:ok', action: 'ban' }));
  }

  else if (action === 'admin:mute') {
    const { userId, roomId, muted } = data;
    if (!userId || !roomId) {
      ws.send(JSON.stringify({ type: 'error', message: '参数不完整' }));
      return;
    }
    await db.query(
      'UPDATE room_members SET is_muted = ? WHERE room_id = ? AND user_id = ?',
      [muted ? 1 : 0, roomId, userId]
    );
    await auditService.log({
      operatorId: meta.userId, action: muted ? 'mute' : 'unmute',
      targetType: 'user', targetId: userId,
      detail: { roomId }, ipAddress: req.socket?.remoteAddress || req.ip || 'unknown'
    });
    ws.send(JSON.stringify({ type: 'admin:ok', action: 'mute', userId, muted }));
  }

  else if (action === 'admin:delete_msg') {
    const { messageId } = data;
    if (!messageId) {
      ws.send(JSON.stringify({ type: 'error', message: '消息 ID 不能为空' }));
      return;
    }
    await db.query('UPDATE messages SET is_deleted = 1 WHERE id = ?', [messageId]);
    await auditService.log({
      operatorId: meta.userId, action: 'msg_delete',
      targetType: 'message', targetId: messageId,
      ipAddress: req.socket?.remoteAddress || req.ip || 'unknown'
    });
    if (meta.channel) {
      conn.broadcastToChannel(meta.channel, {
        type: 'msg_deleted',
        messageId,
        channel: meta.channel
      });
    }
    ws.send(JSON.stringify({ type: 'admin:ok', action: 'delete_msg' }));
  }
}

module.exports = { handleAdmin };
