// connection.js — WebSocket 连接与频道管理
// 维护两个内存数据结构：
//   channelMembers — 每个频道有哪些 WebSocket 连接
//   connectionMeta — 每个 WebSocket 连接的用户元数据
// 提供频道广播、用户列表推送、加入/离开频道等核心功能
const WebSocket = require('ws');

// 频道成员映射：channel -> Set<WebSocket>
const channelMembers = new Map();
// 连接元数据映射：WebSocket -> { userId, username, role, channel, roomId }
const connectionMeta = new Map();

// 获取指定频道的成员集合（不存在则返回空 Set）
function getChannelMembers(channel) {
  return channelMembers.get(channel) || new Set();
}

// 获取某个 WebSocket 连接的元数据
function getConnMeta(ws) {
  return connectionMeta.get(ws);
}

// 设置某个 WebSocket 连接的元数据
function setConnMeta(ws, meta) {
  connectionMeta.set(ws, meta);
}

// 删除某个 WebSocket 连接的元数据（连接关闭时清理）
function removeConnMeta(ws) {
  connectionMeta.delete(ws);
}

// 向频道内所有在线成员广播消息
function broadcastToChannel(channel, payload) {
  const message = JSON.stringify(payload);
  const members = getChannelMembers(channel);
  for (const client of members) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// 收集频道内所有成员的用户名并广播用户列表
function sendUserList(channel) {
  const members = getChannelMembers(channel);
  const users = [];
  for (const client of members) {
    const meta = connectionMeta.get(client);
    if (meta?.username) users.push(meta.username);
  }
  broadcastToChannel(channel, { type: 'users', channel, users });
}

// 检查某用户名是否已在频道中被占用（防止重名）
function isUsernameTaken(channel, username) {
  const members = getChannelMembers(channel);
  for (const client of members) {
    const meta = connectionMeta.get(client);
    if (meta?.username === username) return true;
  }
  return false;
}

// 将 WebSocket 连接加入指定频道
function joinChannel(ws, channel) {
  if (!channelMembers.has(channel)) {
    channelMembers.set(channel, new Set());
  }
  channelMembers.get(channel).add(ws);
}

// 将 WebSocket 连接从指定频道移除，频道空了则删除映射
function leaveChannel(ws, channel) {
  const members = channelMembers.get(channel);
  if (members) {
    members.delete(ws);
    if (members.size === 0) {
      channelMembers.delete(channel);
    }
  }
}

// 将用户从其所在频道移除并清理元数据（断线清理用）
function removeUserFromAll(ws) {
  const meta = connectionMeta.get(ws);
  if (meta?.channel) {
    leaveChannel(ws, meta.channel);
  }
  connectionMeta.delete(ws);
}

module.exports = {
  getChannelMembers,
  getConnMeta,
  setConnMeta,
  removeConnMeta,
  broadcastToChannel,
  sendUserList,
  isUsernameTaken,
  joinChannel,
  leaveChannel,
  removeUserFromAll,
  channelMembers,
  connectionMeta
};
