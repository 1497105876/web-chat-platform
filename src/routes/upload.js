// upload.js — 文件上传 REST API 路由
// 处理图片等文件的上传，保存到 public/uploads 目录
// 使用 multer 中间件处理 multipart/form-data 上传
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { authMiddleware } = require('../auth/middleware');
const router = express.Router();

// 上传文件保存目录
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
// 最大文件大小（默认 5MB），从环境变量读取
const MAX_SIZE = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
// 允许的文件扩展名集合
const ALLOWED = new Set((process.env.ALLOWED_FILE_TYPES || 'jpg,jpeg,png,gif,webp').split(','));

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer 磁盘存储配置
const storage = multer.diskStorage({
  // 文件保存目录
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  // 文件名：时间戳 + 随机十六进制字符串 + 原扩展名，防止文件名冲突和路径穿越
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

// multer 实例：配置存储、大小限制、文件类型过滤
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (ALLOWED.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${ext}，允许: ${[...ALLOWED].join(', ')}`));
    }
  }
});

// 上传接口：需要认证，接收单个文件（字段名 'file'）
router.post('/', authMiddleware, (req, res) => {
  upload.single('file')(req, res, (err) => {
    // multer 自身错误（如文件过大）
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `文件大小不能超过 ${Math.round(MAX_SIZE / 1024 / 1024)}MB` });
        }
        return res.status(400).json({ error: err.message });
      }
      // 其他错误（如不支持的文件类型）
      return res.status(400).json({ error: err.message });
    }
    // 没有上传文件
    if (!req.file) {
      return res.status(400).json({ error: '请选择文件' });
    }
    // 返回上传后的文件信息
    res.json({
      url: `/uploads/${req.file.filename}`,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype
    });
  });
});

module.exports = router;
