const express = require('express');
const db = require('../db');
const msgBuffer = require('../msgBuffer');
const router = express.Router();

router.get('/healthz', (_req, res) => res.json({ ok: true }));

router.post('/api/merge-buffer', async (req, res) => {
  if (!db.isAvailable()) return res.status(500).json({ error: '数据库不可用' });
  const arr = msgBuffer.loadBuffer();
  let ok = 0, fail = 0;
  for (const m of arr) {
    try {
      await db.query(
        'INSERT INTO messages (room_id, sender_id, content, content_type) VALUES (?, ?, ?, ?)',
        [m.roomId || 1, m.senderId || 1, m.content || '', m.contentType || 'text']
      );
      ok++;
    } catch {
      fail++;
    }
  }
  msgBuffer.clearBuffer();
  res.json({ merged: ok, failed: fail });
});

module.exports = router;
