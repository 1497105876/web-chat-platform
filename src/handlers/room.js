// room.js — 频道加入与离开处理器
// 处理用户加入/离开聊天频道的逻辑，包括封禁检查、房间成员注册、历史消息加载
const conn = require('./connection');
const db = require('../db');
const messageService = require('../services/message');
const banService = require('../services/ban');

// 处理用户加入频道
async function handleJoin(ws, data, req) {
  const meta = conn.getConnMeta(ws);
  const channel = (data.channel || '').trim();

  // 频道名不能为空
  if (!channel) {
    ws.send(JSON.stringify({ type: 'error', message: '频道名不能为空' }));
    return;
  }

  // 已在某频道时不允许直接加入另一个，必须先离开
  if (meta.channel) {
    ws.send(JSON.stringify({ type: 'error', message: '已加入频道，请先离开' }));
    return;
  }

  // 数据库可用时执行额外的权限检查
  if (db.isAvailable()) {
    // 检查用户是否被全局封禁
    const banned = await banService.checkBan(meta.userId);
    if (banned) {
      ws.send(JSON.stringify({ type: 'error', message: `你的账号已被封禁，原因: ${banned.reason}` }));
      return;
    }

    // 查询频道是否存在且状态为活跃
    const [rooms] = await db.query('SELECT id, name FROM rooms WHERE name = ? AND status = ?', [channel, 'active']);
    if (rooms.length === 0) {
      ws.send(JSON.stringify({ type: 'error', message: '频道不存在' }));
      return;
    }
    const roomId = rooms[0].id;

    // 如果用户尚未加入该房间成员表，自动注册
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

    // 记录 roomId 到连接元数据，后续聊天/禁言检查会用到
    meta.roomId = roomId;
  }

  // 设置频道并加入频道成员集合
  meta.channel = channel;
  conn.joinChannel(ws, channel);

  console.log(`[JOIN] user=${meta.username}, channel=${channel}, ip=${req.socket?.remoteAddress}`);

  // 加载最近的历史消息发送给加入者
  const history = await messageService.loadRecentMessages(meta.roomId || channel);
  ws.send(JSON.stringify({ type: 'history', channel, messages: history }));

  // 广播系统消息通知频道内其他用户
  conn.broadcastToChannel(channel, {
    type: 'system',
    channel,
    message: `${meta.username} 加入了 ${channel}`,
    createdAt: new Date().toISOString()
  });
  // 更新频道在线用户列表
  conn.sendUserList(channel);
}

// 处理用户离开频道
function handleLeave(ws) {
  const meta = conn.getConnMeta(ws);
  // 没在频道中则无需处理
  if (!meta?.channel) return;

  // 从频道成员集合中移除
  conn.leaveChannel(ws, meta.channel);
  // 广播离开通知
  conn.broadcastToChannel(meta.channel, {
    type: 'system',
    channel: meta.channel,
    message: `${meta.username || '有人'} 离开了 ${meta.channel}`,
    createdAt: new Date().toISOString()
  });
  // 更新在线用户列表
  conn.sendUserList(meta.channel);

  console.log(`[LEAVE] user=${meta.username}, channel=${meta.channel}`);
  // 重置连接的频道信息
  meta.channel = null;
  meta.roomId = null;
}

module.exports = { handleJoin, handleLeave };
