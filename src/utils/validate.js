// validate.js — 输入验证与清洗工具
// 提供文本消息长度限制和文件名清洗功能
// 防止过长消息和恶意文件名导致安全问题

// 单条消息最大长度
const MESSAGE_MAX_LEN = 500;

// 清洗文本消息：去除首尾空格、截断到最大长度
// 返回清洗后的字符串或 null（空消息）
function sanitizeText(text, maxLen) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

// 清洗文件名：只保留字母、数字、点、下划线、连字符，其余替换为下划线
// 最大长度 200，防止路径穿越等安全风险
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

module.exports = { sanitizeText, sanitizeFilename, MESSAGE_MAX_LEN };
