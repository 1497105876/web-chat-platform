require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const db = require('./db');
const conn = require('./handlers/connection');
const { handleJoin, handleLeave } = require('./handlers/room');
const { handleChat } = require('./handlers/chat');
const { handleAdmin } = require('./handlers/admin');
const { handleDm } = require('./handlers/dm');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { verifyToken } = require('./auth/middleware');

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use(healthRoutes);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

function originAllowed(originHeader) {
  const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map(v => v.trim()).filter(Boolean);
  if (allowed.includes('*')) return true;
  if (!originHeader) return false;
  return allowed.includes(originHeader);
}

wss.on('connection', (ws, req) => {
  if (!originAllowed(req.headers.origin)) {
    ws.close(1008, '来源不被允许');
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  if (!token) {
    ws.close(4001, '未提供认证 token');
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    ws.close(4001, 'token 无效或已过期');
    return;
  }

  conn.setConnMeta(ws, {
    userId: payload.id,
    username: payload.username,
    role: payload.role,
    channel: null,
    roomId: null
  });

  ws.on('message', async (raw) => {
    try {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'JSON 格式错误' }));
        return;
      }

      const meta = conn.getConnMeta(ws);
      if (!data?.type) {
        ws.send(JSON.stringify({ type: 'error', message: '缺少消息类型' }));
        return;
      }

      if (data.type === 'join') {
        await handleJoin(ws, data, req);
        return;
      }

      if (data.type === 'leave') {
        handleLeave(ws);
        return;
      }

      if (data.type === 'dm') {
        await handleDm(ws, data, req);
        return;
      }

      if (data.type === 'read') {
        const messageService = require('./services/message');
        if (data.lastMessageId && meta.channel) {
          await messageService.markAsRead(meta.userId, data.lastMessageId);
        }
        return;
      }

      if (data.type && data.type.startsWith('admin:')) {
        if (meta.role !== 'admin' && meta.role !== 'super_admin') {
          ws.send(JSON.stringify({ type: 'error', message: '需要管理员权限' }));
          return;
        }
        await handleAdmin(ws, data, meta, req);
        return;
      }

      if (!meta.username || !meta.channel) {
        ws.send(JSON.stringify({ type: 'error', message: '请先加入频道' }));
        return;
      }

      if (data.type === 'chat') {
        await handleChat(ws, data, meta);
        return;
      }

      ws.send(JSON.stringify({ type: 'error', message: '未知的消息类型' }));
    } catch (err) {
      console.error('处理消息时发生异常:', err);
      ws.send(JSON.stringify({ type: 'error', message: '服务器内部错误。' }));
    }
  });

  ws.on('close', (code, reason) => {
    const meta = conn.getConnMeta(ws);
    console.log(`[CLOSE] code=${code}, reason=${reason?.toString('utf8')}, user=${meta?.username}, channel=${meta?.channel}`);

    if (meta?.channel) {
      conn.leaveChannel(ws, meta.channel);
      conn.broadcastToChannel(meta.channel, {
        type: 'system',
        channel: meta.channel,
        message: `${meta.username || '有人'} 离开了 ${meta.channel}`,
        createdAt: new Date().toISOString()
      });
      conn.sendUserList(meta.channel);
    }
    conn.removeConnMeta(ws);
  });

  ws.on('error', (err) => {
    console.error('[WS ERROR]', err);
  });
});

async function start() {
  try {
    await db.ensureSchema();
    server.listen(PORT, () => {
      console.log(`HTTP/WebSocket 服务已启动，端口 ${PORT}`);
      console.log(`请在浏览器打开 http://localhost:${PORT}`);
    });
  } catch (err) {
    db.setUnavailable();
    console.error('数据库不可用，降级为本地文件缓存模式', err.message);
    server.listen(PORT, () => {
      console.log(`[降级] HTTP/WebSocket 服务已启动（无数据库），端口 ${PORT}`);
      console.log(`请在浏览器打开 http://localhost:${PORT}`);
    });
  }
}

start();
