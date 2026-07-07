const MESSAGE_MAX_LEN = 500;

function sanitizeText(text, maxLen) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

module.exports = { sanitizeText, sanitizeFilename, MESSAGE_MAX_LEN };
