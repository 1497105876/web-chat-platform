// msgBuffer.js — 本地消息文件缓存
// 用途：数据库不可用时（降级模式），将消息暂存到本地 JSON 文件
// 数据库恢复后可通过健康检查接口将缓存数据合并回数据库
const fs = require('fs');
const path = require('path');

// 缓存文件路径：项目根目录下的 db/messages-buffer.json
const bufferFile = path.join(__dirname, '..', 'db', 'messages-buffer.json');

// 从文件加载所有缓存消息，文件不存在或解析失败时返回空数组
function loadBuffer() {
  if (!fs.existsSync(bufferFile)) return [];
  try {
    const data = fs.readFileSync(bufferFile, 'utf-8');
    return JSON.parse(data) || [];
  } catch {
    return [];
  }
}

// 将消息数组写入缓存文件
function saveBuffer(messages) {
  fs.writeFileSync(bufferFile, JSON.stringify(messages, null, 2), 'utf-8');
}

// 追加一条消息到缓存文件
function appendBuffer(msg) {
  const arr = loadBuffer();
  arr.push(msg);
  saveBuffer(arr);
}

// 清空缓存文件（合并回数据库后调用）
function clearBuffer() {
  if (fs.existsSync(bufferFile)) fs.unlinkSync(bufferFile);
}

module.exports = { loadBuffer, saveBuffer, appendBuffer, clearBuffer };
