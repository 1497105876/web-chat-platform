const db = require('../db');
const msgBuffer = require('../msgBuffer');

async function loadRecentMessages(roomIdOrChannel, limit = 50) {
  if (!db.isAvailable()) {
    const all = msgBuffer.loadBuffer();
    return all.filter(m => m.channel === roomIdOrChannel).slice(-limit);
  }

  let roomId = roomIdOrChannel;
  if (typeof roomIdOrChannel === 'string') {
    const [rooms] = await db.query('SELECT id FROM rooms WHERE name = ?', [roomIdOrChannel]);
    if (rooms.length === 0) return [];
    roomId = rooms[0].id;
  }

  const [rows] = await db.query(
    `SELECT m.id, m.content, m.content_type, m.reply_to_id, m.created_at AS createdAt,
            u.username, u.nickname
     FROM messages m
     JOIN users u ON m.sender_id = u.id
     WHERE m.room_id = ? AND m.is_deleted = 0
     ORDER BY m.created_at DESC LIMIT ?`,
    [roomId, limit]
  );

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

  if (messages.length > 0) {
    const replyIds = messages.filter(m => m.replyToId).map(m => m.replyToId);
    if (replyIds.length > 0) {
      const [replies] = await db.query(
        `SELECT m.id, m.content, u.username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id IN (?)`,
        [replyIds]
      );
      const replyMap = new Map(replies.map(r => {
        let c; try { c = JSON.parse(r.content); } catch { c = { text: r.content }; }
        return [r.id, { id: r.id, username: r.username, preview: (c.text || '').slice(0, 100) }];
      }));
      messages.forEach(m => {
        if (m.replyToId) m.replyTo = replyMap.get(m.replyToId) || null;
      });
    }
  }

  return messages;
}

async function saveMessage({ roomId, senderId, content, contentType = 'text', replyToId = null }) {
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

async function markAsRead(userId, lastMessageId) {
  if (!db.isAvailable()) return;
  await db.query(
    `INSERT IGNORE INTO message_reads (message_id, user_id) SELECT ?, ? FROM DUAL WHERE NOT EXISTS (
      SELECT 1 FROM message_reads WHERE message_id = ? AND user_id = ?
    )`,
    [lastMessageId, userId, lastMessageId, userId]
  );
}

module.exports = { loadRecentMessages, saveMessage, getMessageById, markAsRead };
