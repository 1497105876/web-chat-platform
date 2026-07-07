const conn = require('./connection');
const db = require('../db');
const messageService = require('../services/message');
const banService = require('../services/ban');
const { sanitizeText, MESSAGE_MAX_LEN } = require('../utils/validate');

async function handleChat(ws, data, meta) {
  if (db.isAvailable()) {
    const roomBanned = await banService.checkBan(meta.userId, meta.roomId);
    if (roomBanned) {
      ws.send(JSON.stringify({ type: 'error', message: '你已被禁止在该频道发言' }));
      return;
    }

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

  let contentObj;
  let contentType = data.contentType || 'text';

  if (contentType === 'text') {
    const text = sanitizeText(data.content?.text || data.content, MESSAGE_MAX_LEN);
    if (!text) {
      ws.send(JSON.stringify({ type: 'error', message: '消息不能为空' }));
      return;
    }
    contentObj = { text };
  } else if (contentType === 'image') {
    if (!data.content?.url) {
      ws.send(JSON.stringify({ type: 'error', message: '图片 URL 不能为空' }));
      return;
    }
    contentObj = { url: data.content.url, width: data.content.width, height: data.content.height };
  } else {
    ws.send(JSON.stringify({ type: 'error', message: '不支持的消息类型' }));
    return;
  }

  const replyToId = data.replyTo || null;
  let replyToInfo = null;

  if (replyToId && db.isAvailable()) {
    const original = await messageService.getMessageById(replyToId);
    if (original) {
      replyToInfo = { id: original.id, username: original.username, preview: (original.content || '').slice(0, 100) };
    }
  }

  const msgId = await messageService.saveMessage({
    roomId: meta.roomId,
    senderId: meta.userId,
    content: JSON.stringify(contentObj),
    contentType,
    replyToId
  });

  console.log(`[CHAT] user=${meta.username}, channel=${meta.channel}, type=${contentType}`);

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
