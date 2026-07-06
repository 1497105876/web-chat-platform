require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const mysql = require('mysql2/promise');

const PORT = Number(process.env.PORT) || 3000;
const HISTORY_LIMIT = Number(process.env.MESSAGE_HISTORY_LIMIT) || 50;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

const CHANNELS = ['room1', 'room2', 'room3'];
const MESSAGE_MAX_LEN = 500;


const msgBuffer = require('./msgBuffer');
let dbAvailable = true;
let pool;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'chat_app',
      connectionLimit: 10,
      timezone: 'Z'
    });
  }
  return pool;
}



const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const channelMembers = new Map();
const connectionMeta = new Map();

CHANNELS.forEach((ch) => channelMembers.set(ch, new Set()));

async function ensureSchema() {
  if (!dbAvailable) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      channel VARCHAR(100) NOT NULL,
      username VARCHAR(50) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_channel_created_at (channel, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function loadRecentMessages(channel, limit = HISTORY_LIMIT) {
  if (!dbAvailable) {
    const all = msgBuffer.loadBuffer();
    return all.filter(m => m.channel === channel).slice(-limit);
  }
  const [rows] = await getPool().query(
    'SELECT id, channel, username, content, created_at AS createdAt FROM messages WHERE channel = ? ORDER BY created_at DESC LIMIT ?',
    [channel, limit]
  );
  return rows.reverse();
}

async function saveMessage({ channel, username, content }) {
  if (!dbAvailable) {
    msgBuffer.appendBuffer({ channel, username, content, createdAt: new Date().toISOString() });
    return;
  }
  await getPool().query(
    'INSERT INTO messages (channel, username, content) VALUES (?, ?, ?)',
    [channel, username, content]
  );
}

function originAllowed(originHeader) {
  if (ALLOWED_ORIGINS.includes('*')) return true;
  if (!originHeader) return false;
  return ALLOWED_ORIGINS.includes(originHeader);
}

function broadcastToChannel(channel, payload) {
  const message = JSON.stringify(payload);
  const members = channelMembers.get(channel) || new Set();
  for (const client of members) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function sendUserList(channel) {
  const members = channelMembers.get(channel) || new Set();
  const users = [];
  for (const client of members) {
    const meta = connectionMeta.get(client);
    if (meta?.username) users.push(meta.username);
  }
  broadcastToChannel(channel, { type: 'users', channel, users });
}

function isUsernameTaken(channel, username) {
  const members = channelMembers.get(channel) || new Set();
  for (const client of members) {
    const meta = connectionMeta.get(client);
    if (meta?.username === username) return true;
  }
  return false;
}

function validateChannel(channel) {
  return CHANNELS.includes(channel);
}

function sanitizeText(text, maxLen) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

wss.on('connection', (ws, req) => {
  if (!originAllowed(req.headers.origin)) {
    ws.close(1008, '来源不被允许');
    return;
  }
  connectionMeta.set(ws, { username: null, channel: null, lastMessageAt: 0 });
  ws.on('message', async (raw) => {
    try {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'JSON 格式错误' }));
        return;
      }

      const meta = connectionMeta.get(ws);
      if (!data?.type) {
        ws.send(JSON.stringify({ type: 'error', message: '缺少消息类型' }));
        return;
      }

      if (data.type === 'join') {
        const username = sanitizeText(data.username, 30);
        const channel = sanitizeText(data.channel, 20);

        if (!username) {
          ws.send(JSON.stringify({ type: 'error', message: '需要用户名' }));
          return;
        }
        if (username === '系统') {
          ws.send(JSON.stringify({ type: 'error', message: '用户名不可为 系统' }));
          return;
        }
        if (!channel || !validateChannel(channel)) {
          ws.send(JSON.stringify({ type: 'error', message: '频道无效' }));
          return;
        }
        if (isUsernameTaken(channel, username)) {
          ws.send(JSON.stringify({ type: 'error', message: '该频道已有同名用户' }));
          return;
        }
        if (meta.channel && meta.username) {
          ws.send(JSON.stringify({ type: 'error', message: '已加入频道' }));
          return;
        }

        meta.username = username;
        meta.channel = channel;
        channelMembers.get(channel)?.add(ws);

        // 终端打印：用户加入
        console.log(`[JOIN] user=${username}, channel=${channel}, ip=${req.socket && req.socket.remoteAddress}`);

        const history = await loadRecentMessages(channel);
        ws.send(JSON.stringify({ type: 'history', channel, messages: history }));

        broadcastToChannel(channel, {
          type: 'system',
          channel,
          message: `${username} 加入了 ${channel}`,
          createdAt: new Date().toISOString()
        });
        sendUserList(channel);
        return;
      }

      if (!meta.username || !meta.channel) {
        ws.send(JSON.stringify({ type: 'error', message: '请先加入频道' }));
        return;
      }


      if (data.type === 'chat') {
        const content = sanitizeText(data.content, MESSAGE_MAX_LEN);
        if (!content) {
          ws.send(JSON.stringify({ type: 'error', message: '消息不能为空' }));
          return;
        }
        try {
          await saveMessage({ channel: meta.channel, username: meta.username, content });
          // 终端打印：用户发送消息
          console.log(`[CHAT] user=${meta.username}, channel=${meta.channel}, content=${content}`);
        } catch (err) {
          console.error('保存消息到数据库失败:', err);
          ws.send(JSON.stringify({ type: 'error', message: '消息保存失败，请稍后重试。' }));
          return;
        }
        const payload = {
          type: 'chat',
          channel: meta.channel,
          username: meta.username,
          content,
          createdAt: new Date().toISOString()
        };
        broadcastToChannel(meta.channel, payload);
        return;
      }
      ws.send(JSON.stringify({ type: 'error', message: '未知的消息类型' }));
    } catch (err) {
      console.error('处理消息时发生异常:', err);
      ws.send(JSON.stringify({ type: 'error', message: '服务器内部错误。' }));
    }
  });

  ws.on('close', (code, reason) => {
    const meta = connectionMeta.get(ws);
    console.log(`[CLOSE] code=${code}, reason=${reason && reason.toString('utf8')}, user=${meta?.username}, channel=${meta?.channel}`);
    if (meta?.channel) {
      const members = channelMembers.get(meta.channel);
      members?.delete(ws);
      broadcastToChannel(meta.channel, {
        type: 'system',
        channel: meta.channel,
        message: `${meta.username || '有人'} 离开了 ${meta.channel}`,
        createdAt: new Date().toISOString()
      });
      sendUserList(meta.channel);
    }
    connectionMeta.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[WS ERROR]', err);
  });
});

async function start() {
  try {
    await ensureSchema();
    server.listen(PORT, () => {
      console.log(`HTTP/WebSocket 服务已启动，端口 ${PORT}`);
      console.log(`请在浏览器打开 http://localhost:${PORT}`);
    });
  } catch (err) {
    dbAvailable = false;
    console.error('数据库不可用，降级为本地文件缓存模式', err);
    server.listen(PORT, () => {
      console.log(`[降级] HTTP/WebSocket 服务已启动（无数据库），端口 ${PORT}`);
      console.log(`请在浏览器打开 http://localhost:${PORT}`);
    });
  }
}

app.post('/api/merge-buffer', async (req, res) => {
  if (!dbAvailable) return res.status(500).json({ error: '数据库不可用' });
  const arr = msgBuffer.loadBuffer();
  let ok = 0, fail = 0;
  for (const m of arr) {
    try {
      await saveMessage(m);
      ok++;
    } catch {
      fail++;
    }
  }
  msgBuffer.clearBuffer();
  res.json({ merged: ok, failed: fail });
});


start();
