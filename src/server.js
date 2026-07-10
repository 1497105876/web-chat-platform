// server.js — Web 聊天平台的主入口文件
// 负责：初始化 Express HTTP 服务 + WebSocket 实时通信服务
// 功能：用户认证、频道加入/离开、聊天消息、私信、撤回、管理员操作
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
const uploadRoutes = require('./routes/upload');
const { verifyToken } = require('./auth/middleware');

// 从环境变量读取端口号，默认 3000
const PORT = Number(process.env.PORT) || 3000;

const app = express();
// 托管前端静态文件（public 目录）
app.use(express.static(path.join(__dirname, '..', 'public')));
// 解析 JSON 请求体
app.use(express.json());
// 挂载各 REST API 路由
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use(healthRoutes);

// 创建 HTTP 服务器并附带 WebSocket 服务，路径为 /ws
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// 检查请求来源是否在允许列表中，防止跨域 WebSocket 攻击
function originAllowed(originHeader) {
  const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map(v => v.trim()).filter(Boolean);
  if (allowed.includes('*')) return true;
  if (!originHeader) return false;
  return allowed.includes(originHeader);
}

// WebSocket 连接建立时的处理逻辑
wss.on('connection', async (ws, req) => {
  // 第一步：校验来源
  if (!originAllowed(req.headers.origin)) {
    ws.close(1008, '来源不被允许');
    return;
  }

  // 第二步：从 URL 参数提取认证 token
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  if (!token) {
    ws.close(4001, '未提供认证 token');
    return;
  }

  // 第三步：验证 token 有效性
  const payload = verifyToken(token);
  if (!payload) {
    ws.close(4001, 'token 无效或已过期');
    return;
  }

  // 将用户信息绑定到 WebSocket 连接上，后续消息处理时可直接读取
  conn.setConnMeta(ws, {
    userId: payload.id,
    username: payload.username,
    role: payload.role,
    channel: null,
    roomId: null
  });

  // 连接建立后，自动加载该用户已有的私聊房间列表，推送给前端
  if (db.isAvailable()) {
    try {
      const [dmRooms] = await db.query(
        `SELECT r.id AS roomId, r.name AS channel, u.id AS targetId, u.username, u.nickname
         FROM rooms r
         JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ?
         JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id != ?
         JOIN users u ON u.id = rm2.user_id
         WHERE r.type = 'dm' AND r.status = 'active'
         ORDER BY r.id DESC`,
        [payload.id, payload.id]
      );
      if (dmRooms.length > 0) {
        ws.send(JSON.stringify({ type: 'dm:list', rooms: dmRooms }));
      }
    } catch (e) {
      console.error('加载私聊列表失败:', e.message);
    }
  }

  // 处理客户端发来的每一条 WebSocket 消息
  ws.on('message', async (raw) => {
    try {
      // 尝试解析 JSON
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'JSON 格式错误' }));
        return;
      }

      const meta = conn.getConnMeta(ws);
      // 消息必须有 type 字段
      if (!data?.type) {
        ws.send(JSON.stringify({ type: 'error', message: '缺少消息类型' }));
        return;
      }

      // 处理加入频道请求
      if (data.type === 'join') {
        await handleJoin(ws, data, req);
        return;
      }

      // 处理离开频道请求
      if (data.type === 'leave') {
        handleLeave(ws);
        return;
      }

      // 处理私信（DM）请求
      if (data.type === 'dm') {
        await handleDm(ws, data, req);
        return;
      }

      // 处理消息撤回请求
      if (data.type === 'recall') {
        const messageService = require('./services/message');
        const auditService = require('./services/audit');
        if (!data.messageId) {
          ws.send(JSON.stringify({ type: 'error', message: '消息 ID 不能为空' }));
          return;
        }
        // 调用服务层执行撤回逻辑
        const result = await messageService.recallMessage(data.messageId, meta.userId);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: 'error', message: result.error }));
          return;
        }
        // 记录审计日志
        await auditService.log({
          operatorId: meta.userId, action: 'msg_delete',
          targetType: 'message', targetId: data.messageId,
          detail: { type: 'recall' },
          ipAddress: req.socket?.remoteAddress || 'unknown'
        });
        // 广播撤回通知给频道内所有用户
        if (meta.channel) {
          conn.broadcastToChannel(meta.channel, {
            type: 'msg_deleted',
            messageId: data.messageId,
            channel: meta.channel
          });
        }
        ws.send(JSON.stringify({ type: 'recall_ok', messageId: data.messageId }));
        return;
      }

      // 处理已读标记
      if (data.type === 'read') {
        const messageService = require('./services/message');
        if (data.lastMessageId && meta.channel) {
          await messageService.markAsRead(meta.userId, data.lastMessageId);
        }
        return;
      }

      // 处理管理员操作（前缀为 admin:）
      if (data.type && data.type.startsWith('admin:')) {
        if (meta.role !== 'admin' && meta.role !== 'super_admin') {
          ws.send(JSON.stringify({ type: 'error', message: '需要管理员权限' }));
          return;
        }
        await handleAdmin(ws, data, meta, req);
        return;
      }

      // 发送聊天消息前必须已加入频道
      if (!meta.username || !meta.channel) {
        ws.send(JSON.stringify({ type: 'error', message: '请先加入频道' }));
        return;
      }

      // 处理聊天消息
      if (data.type === 'chat') {
        await handleChat(ws, data, meta);
        return;
      }

      // 未识别的消息类型
      ws.send(JSON.stringify({ type: 'error', message: '未知的消息类型' }));
    } catch (err) {
      // 兜底异常处理，防止进程崩溃
      console.error('处理消息时发生异常:', err);
      ws.send(JSON.stringify({ type: 'error', message: '服务器内部错误。' }));
    }
  });

  // WebSocket 连接关闭时的清理逻辑
  ws.on('close', (code, reason) => {
    const meta = conn.getConnMeta(ws);
    console.log(`[CLOSE] code=${code}, reason=${reason?.toString('utf8')}, user=${meta?.username}, channel=${meta?.channel}`);

    // 如果用户在频道中，通知其他成员并更新用户列表
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

  // WebSocket 错误事件
  ws.on('error', (err) => {
    console.error('[WS ERROR]', err);
  });
});

// 启动服务：先尝试连接数据库，失败则降级为无数据库模式
async function start() {
  try {
    // 初始化数据库表结构
    await db.ensureSchema();
    server.listen(PORT, () => {
      console.log(`HTTP/WebSocket 服务已启动，端口 ${PORT}`);
      console.log(`请在浏览器打开 http://localhost:${PORT}`);
    });
  } catch (err) {
    // 数据库不可用时降级运行，使用本地文件缓存消息
    db.setUnavailable();
    console.error('数据库不可用，降级为本地文件缓存模式', err.message);
    server.listen(PORT, () => {
      console.log(`[降级] HTTP/WebSocket 服务已启动（无数据库），端口 ${PORT}`);
      console.log(`请在浏览器打开 http://localhost:${PORT}`);
    });
  }
}

start();
