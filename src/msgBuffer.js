// 本地消息缓存管理
const fs = require('fs');
const path = require('path');

const bufferFile = path.join(__dirname, '..', 'db', 'messages-buffer.json');

function loadBuffer() {
  if (!fs.existsSync(bufferFile)) return [];
  try {
    const data = fs.readFileSync(bufferFile, 'utf-8');
    return JSON.parse(data) || [];
  } catch {
    return [];
  }
}

function saveBuffer(messages) {
  fs.writeFileSync(bufferFile, JSON.stringify(messages, null, 2), 'utf-8');
}

function appendBuffer(msg) {
  const arr = loadBuffer();
  arr.push(msg);
  saveBuffer(arr);
}

function clearBuffer() {
  if (fs.existsSync(bufferFile)) fs.unlinkSync(bufferFile);
}

module.exports = { loadBuffer, saveBuffer, appendBuffer, clearBuffer };
