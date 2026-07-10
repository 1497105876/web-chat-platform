// health.js — 健康检查与维护 REST API 路由
// 提供：存活检查接口 + 缓存消息合并回数据库的维护接口
const express = require('express');
const db = require('../db');
const msgBuffer = require('../msgBuffer');
const router = express.Router();

// 存活检查接口，返回服务是否正常运行
router.get('/healthz', (_req, res) => res.json({ ok: true }));

// 将本地缓存的消息合并回数据库（数据库恢复后手动调用）
router.post('/api/merge-buffer', async (req, res) => {
  if (!db.isAvailable()) return res.status(500).json({ error: '数据库不可用' });
  // 加载所有缓存消息
  const arr = msgBuffer.loadBuffer();
  let ok = 0, fail = 0;
  // 逐条插入数据库
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
  // 合并完成后清空缓存
  msgBuffer.clearBuffer();
  res.json({ merged: ok, failed: fail });
});

module.exports = router;
