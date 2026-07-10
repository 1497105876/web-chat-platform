// chat.js — 聊天消息处理器
// 处理用户发送的聊天消息：权限检查、内容校验、持久化存储、频道广播
const conn = require('./connection');
const db = require('../db');
const messageService = require('../services/message');
const banService = require('../services/ban');
const { sanitizeText, MESSAGE_MAX_LEN } = require('../utils/validate');

// 处理聊天消息的主函数
async function handleChat(ws, data, meta) {
  // 第一步：数据库可用时检查封禁和禁言状态
  if (db.isAvailable()) {
    // 检查用户是否被禁止在该房间发言
    const roomBanned = await banService.checkBan(meta.userId, meta.roomId);
    if (roomBanned) {
      ws.send(JSON.stringify({ type: 'error', message: '你已被禁止在该频道发言' }));
      return;
    }

    // 检查用户是否被管理员禁言
    if (meta.roomId) {
      const [muted] = await db.query(
        'SELECT is_muted FROM room_members WHERE room_id = ? AND user_id = ?',
        [meta.roomId, meta.userId]
      );
      if (muted[0]?.is_muted) {
        ws.send(JSON.stringify({ type: 'error', message: '你已被管理员禁言' }));
        return;
      }
    }
  }

  // 第二步：根据消息类型处理内容
  let contentObj;
  let contentType = data.contentType || 'text';

  if (contentType === 'text') {
    // 文本消息：清洗并截断
    const text = sanitizeText(data.content?.text || data.content, MESSAGE_MAX_LEN);
    if (!text) {
      ws.send(JSON.stringify({ type: 'error', message: '消息不能为空' }));
      return;
    }
    contentObj = { text };
  } else if (contentType === 'image') {
    // 图片消息：必须有 URL
    if (!data.content?.url) {
      ws.send(JSON.stringify({ type: 'error', message: '图片 URL 不能为空' }));
      return;
    }
    contentObj = { url: data.content.url, width: data.content.width, height: data.content.height };
  } else {
    // 不支持的消息类型
    ws.send(JSON.stringify({ type: 'error', message: '不支持的消息类型' }));
    return;
  }

  // 第三步：处理回复引用，生成被回复消息的预览信息
  const replyToId = data.replyTo || null;
  let replyToInfo = null;

  if (replyToId && db.isAvailable()) {
    const original = await messageService.getMessageById(replyToId);
    if (original) {
      const c = original.content;
      // 生成预览：文本取前100字，图片显示 [图片]
      const preview = c?.text ? c.text.slice(0, 100) : (c?.url ? '[图片]' : '...');
      replyToInfo = { id: original.id, username: original.username, preview };
    }
  }

  // 第四步：持久化消息到数据库或本地缓存
  const msgId = await messageService.saveMessage({
    roomId: meta.roomId,
    senderId: meta.userId,
    content: JSON.stringify(contentObj),
    contentType,
    replyToId
  });

  console.log(`[CHAT] user=${meta.username}, channel=${meta.channel}, type=${contentType}`);

  // 第五步：构建消息载荷并广播给频道内所有成员
  const payload = {
    type: 'chat',
    id: msgId,
    channel: meta.channel,
    username: meta.username,
    content: contentObj,
    contentType,
    replyTo: replyToInfo,
    createdAt: new Date().toISOString()
  };
  conn.broadcastToChannel(meta.channel, payload);
}

module.exports = { handleChat };
