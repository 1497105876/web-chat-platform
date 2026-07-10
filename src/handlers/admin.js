// admin.js — 管理员 WebSocket 操作处理器
// 处理通过 WebSocket 发送的管理员操作：踢出、封禁、禁言、删除消息
// 所有操作前已在 server.js 中校验了管理员权限
const conn = require('./connection');
const db = require('../db');
const banService = require('../services/ban');
const auditService = require('../services/audit');

// 管理员操作主入口，根据 action 类型分发到不同处理逻辑
async function handleAdmin(ws, data, meta, req) {
  const action = data.type;

  // 操作一：踢出用户出房间
  if (action === 'admin:kick') {
    const { userId, roomId } = data;
    if (!userId || !roomId) {
      ws.send(JSON.stringify({ type: 'error', message: '参数不完整' }));
      return;
    }
    // 从房间成员表中删除该用户
    await db.query('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);
    // 记录审计日志
    await auditService.log({
      operatorId: meta.userId, action: 'kick',
      targetType: 'user', targetId: userId,
      detail: { roomId }, ipAddress: req.socket?.remoteAddress || req.ip || 'unknown'
    });

    // 遍历所有 WebSocket 连接，找到被踢用户并强制断开
    for (const [client, clientMeta] of conn.connectionMeta) {
      if (clientMeta.userId === userId && clientMeta.roomId === roomId) {
        client.send(JSON.stringify({ type: 'kicked', message: '你已被管理员踢出该房间' }));
        client.close(4002, '被踢出');
      }
    }

    // 更新房间在线用户列表
    const [room] = await db.query('SELECT name FROM rooms WHERE id = ?', [roomId]);
    if (room[0]) conn.sendUserList(room[0].name);
    ws.send(JSON.stringify({ type: 'admin:ok', action: 'kick' }));
  }

  // 操作二：全局封禁用户
  else if (action === 'admin:ban') {
    const { userId, reason, expiresAt } = data;
    if (!userId || !reason) {
      ws.send(JSON.stringify({ type: 'error', message: '用户 ID 和封禁原因不能为空' }));
      return;
    }
    // 写入封禁记录
    await banService.banUser(userId, meta.userId, reason, 'global', null, expiresAt || null);
    await auditService.log({
      operatorId: meta.userId, action: 'ban',
      targetType: 'user', targetId: userId,
      detail: { reason, expiresAt }, ipAddress: req.socket?.remoteAddress || req.ip || 'unknown'
    });

    // 强制断开被封禁用户的所有 WebSocket 连接
    for (const [client, clientMeta] of conn.connectionMeta) {
      if (clientMeta.userId === userId) {
        client.send(JSON.stringify({ type: 'banned', message: `你已被封禁，原因: ${reason}`, expiresAt }));
        client.close(4003, '被封禁');
      }
    }
    ws.send(JSON.stringify({ type: 'admin:ok', action: 'ban' }));
  }

  // 操作三：房间内禁言/解除禁言
  else if (action === 'admin:mute') {
    const { userId, roomId, muted } = data;
    if (!userId || !roomId) {
      ws.send(JSON.stringify({ type: 'error', message: '参数不完整' }));
      return;
    }
    // 更新成员表的禁言标志
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

  // 操作四：删除（撤回）消息
  else if (action === 'admin:delete_msg') {
    const { messageId } = data;
    if (!messageId) {
      ws.send(JSON.stringify({ type: 'error', message: '消息 ID 不能为空' }));
      return;
    }
    // 软删除：仅标记 is_deleted = 1
    await db.query('UPDATE messages SET is_deleted = 1 WHERE id = ?', [messageId]);
    await auditService.log({
      operatorId: meta.userId, action: 'msg_delete',
      targetType: 'message', targetId: messageId,
      ipAddress: req.socket?.remoteAddress || req.ip || 'unknown'
    });
    // 广播消息删除通知
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
