// message.js — 消息服务层
// 负责消息的持久化、读取、已读标记、撤回等核心业务逻辑
// 支持降级模式：数据库不可用时回退到本地文件缓存
const db = require('../db');
const msgBuffer = require('../msgBuffer');

// 加载某个频道/房间的最近消息（默认50条）
async function loadRecentMessages(roomIdOrChannel, limit = 50) {
  // 降级模式：从本地文件缓存中筛选
  if (!db.isAvailable()) {
    const all = msgBuffer.loadBuffer();
    return all.filter(m => m.channel === roomIdOrChannel).slice(-limit);
  }

  // 如果传入的是频道名（字符串），先查表转换为 roomId
  let roomId = roomIdOrChannel;
  if (typeof roomIdOrChannel === 'string') {
    const [rooms] = await db.query('SELECT id FROM rooms WHERE name = ?', [roomIdOrChannel]);
    if (rooms.length === 0) return [];
    roomId = rooms[0].id;
  }

  // 查询最近消息，按时间倒序取 limit 条，关联用户表获取用户名
  const [rows] = await db.query(
    `SELECT m.id, m.content, m.content_type, m.reply_to_id, m.created_at AS createdAt,
            u.username, u.nickname
     FROM messages m
     JOIN users u ON m.sender_id = u.id
     WHERE m.room_id = ? AND m.is_deleted = 0
     ORDER BY m.created_at DESC LIMIT ?`,
    [roomId, limit]
  );

  // 反转为时间正序，并解析消息内容 JSON
  const messages = rows.reverse().map(row => {
    let content;
    try { content = JSON.parse(row.content); } catch { content = { text: row.content }; }
    return {
      id: row.id,
      username: row.username,
      content,
      contentType: row.content_type,
      replyToId: row.reply_to_id,
      createdAt: row.createdAt
    };
  });

  // 如果有回复引用的消息，批量查询被引用消息的预览信息
  if (messages.length > 0) {
    const replyIds = messages.filter(m => m.replyToId).map(m => m.replyToId);
    if (replyIds.length > 0) {
      const [replies] = await db.query(
        `SELECT m.id, m.content, u.username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id IN (?)`,
        [replyIds]
      );
      // 构建回复映射表：messageId -> { id, username, preview }
      const replyMap = new Map(replies.map(r => {
        let c; try { c = JSON.parse(r.content); } catch { c = { text: r.content }; }
        const preview = c.text ? c.text.slice(0, 100) : (c.url ? '[图片]' : '...');
        return [r.id, { id: r.id, username: r.username, preview }];
      }));
      // 将回复信息挂到对应消息上
      messages.forEach(m => {
        if (m.replyToId) m.replyTo = replyMap.get(m.replyToId) || null;
      });
    }
  }

  return messages;
}

// 保存消息到数据库或本地缓存，返回消息 ID
async function saveMessage({ roomId, senderId, content, contentType = 'text', replyToId = null }) {
  // 降级模式：追加到本地文件缓存
  if (!db.isAvailable()) {
    msgBuffer.appendBuffer({ roomId, senderId, content, contentType, createdAt: new Date().toISOString() });
    return Date.now();
  }
  const [result] = await db.query(
    'INSERT INTO messages (room_id, sender_id, content, content_type, reply_to_id) VALUES (?, ?, ?, ?, ?)',
    [roomId, senderId, content, contentType, replyToId]
  );
  return result.insertId;
}

// 根据 ID 查询单条消息（含发送者用户名），数据库不可用时返回 null
async function getMessageById(id) {
  if (!db.isAvailable()) return null;
  const [rows] = await db.query(
    `SELECT m.id, m.content, m.content_type, m.created_at AS createdAt,
            u.username, u.nickname
     FROM messages m
     JOIN users u ON m.sender_id = u.id
     WHERE m.id = ?`,
    [id]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  let content;
  try { content = JSON.parse(row.content); } catch { content = { text: row.content }; }
  return { ...row, content };
}

// 标记消息为已读（防止重复标记）
async function markAsRead(userId, lastMessageId) {
  if (!db.isAvailable()) return;
  await db.query(
    `INSERT IGNORE INTO message_reads (message_id, user_id) SELECT ?, ? FROM DUAL WHERE NOT EXISTS (
      SELECT 1 FROM message_reads WHERE message_id = ? AND user_id = ?
    )`,
    [lastMessageId, userId, lastMessageId, userId]
  );
}

// 撤回消息：校验发送者身份和2分钟时间限制
async function recallMessage(messageId, userId) {
  if (!db.isAvailable()) return { ok: false, error: '数据库不可用' };
  const [rows] = await db.query(
    'SELECT id, sender_id, created_at FROM messages WHERE id = ? AND is_deleted = 0',
    [messageId]
  );
  if (!rows[0]) return { ok: false, error: '消息不存在或已撤回' };
  const msg = rows[0];
  // 只能撤回自己发的消息
  if (msg.sender_id !== userId) return { ok: false, error: '只能撤回自己的消息' };
  // 超过2分钟不允许撤回
  const elapsed = Date.now() - new Date(msg.created_at).getTime();
  if (elapsed > 2 * 60 * 1000) return { ok: false, error: '超过 2 分钟，无法撤回' };
  // 软删除：标记为已删除
  await db.query('UPDATE messages SET is_deleted = 1 WHERE id = ?', [messageId]);
  return { ok: true };
}

module.exports = { loadRecentMessages, saveMessage, getMessageById, markAsRead, recallMessage };
