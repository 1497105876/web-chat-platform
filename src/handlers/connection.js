const WebSocket = require('ws');

const channelMembers = new Map();
const connectionMeta = new Map();

function getChannelMembers(channel) {
  return channelMembers.get(channel) || new Set();
}

function getConnMeta(ws) {
  return connectionMeta.get(ws);
}

function setConnMeta(ws, meta) {
  connectionMeta.set(ws, meta);
}

function removeConnMeta(ws) {
  connectionMeta.delete(ws);
}

function broadcastToChannel(channel, payload) {
  const message = JSON.stringify(payload);
  const members = getChannelMembers(channel);
  for (const client of members) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function sendUserList(channel) {
  const members = getChannelMembers(channel);
  const users = [];
  for (const client of members) {
    const meta = connectionMeta.get(client);
    if (meta?.username) users.push(meta.username);
  }
  broadcastToChannel(channel, { type: 'users', channel, users });
}

function isUsernameTaken(channel, username) {
  const members = getChannelMembers(channel);
  for (const client of members) {
    const meta = connectionMeta.get(client);
    if (meta?.username === username) return true;
  }
  return false;
}

function joinChannel(ws, channel) {
  if (!channelMembers.has(channel)) {
    channelMembers.set(channel, new Set());
  }
  channelMembers.get(channel).add(ws);
}

function leaveChannel(ws, channel) {
  const members = channelMembers.get(channel);
  if (members) {
    members.delete(ws);
    if (members.size === 0) {
      channelMembers.delete(channel);
    }
  }
}

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
