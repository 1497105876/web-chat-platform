// db.js — 数据库连接与表结构管理
// 负责：创建 MySQL 连接池、初始化所有表结构、提供查询接口
// 支持降级模式：数据库不可用时通过标志位切换到文件缓存
const mysql = require('mysql2/promise');

// 连接池实例（惰性创建）
let pool = null;
// 数据库可用性标志
let dbAvailable = true;

// 获取或创建 MySQL 连接池，单例模式
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'chat_app',
      connectionLimit: 10,
      timezone: '+08:00'
    });
  }
  return pool;
}

// 查询数据库是否可用
function isAvailable() { return dbAvailable; }
// 标记数据库不可用（降级模式）
function setUnavailable() { dbAvailable = false; }

// 初始化所有表结构，服务启动时调用一次
async function ensureSchema() {
  const pool = getPool();

  // 用户表：存储账号、昵称、密码哈希、角色、状态等
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(30) NOT NULL,
      nickname VARCHAR(30) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      avatar_url VARCHAR(500) DEFAULT NULL,
      role ENUM('user','admin','super_admin') NOT NULL DEFAULT 'user',
      status ENUM('active','banned','deleted') NOT NULL DEFAULT 'active',
      last_login_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE INDEX idx_username (username),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 房间表：公共频道和私聊房间
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(50) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      description VARCHAR(500) DEFAULT NULL,
      type ENUM('public','private','dm') NOT NULL DEFAULT 'public',
      owner_id BIGINT UNSIGNED DEFAULT NULL,
      max_members INT UNSIGNED NOT NULL DEFAULT 500,
      status ENUM('active','archived','deleted') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE INDEX idx_name (name),
      INDEX idx_type_status (type, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 房间成员表：用户与房间的多对多关系，含角色和禁言状态
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_members (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      room_id INT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      role ENUM('member','moderator','owner') NOT NULL DEFAULT 'member',
      is_muted TINYINT(1) NOT NULL DEFAULT 0,
      last_read_at TIMESTAMP NULL DEFAULT NULL,
      joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE INDEX idx_room_user (room_id, user_id),
      INDEX idx_user_id (user_id),
      CONSTRAINT fk_rm_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      CONSTRAINT fk_rm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 消息表：存储聊天消息内容、类型、回复关系、删除标记
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      room_id INT UNSIGNED NOT NULL,
      sender_id BIGINT UNSIGNED NOT NULL,
      content TEXT NOT NULL,
      content_type ENUM('text','image','file','system','voice') NOT NULL DEFAULT 'text',
      reply_to_id BIGINT UNSIGNED DEFAULT NULL,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      INDEX idx_room_created (room_id, created_at DESC),
      INDEX idx_sender (sender_id),
      INDEX idx_reply (reply_to_id),
      CONSTRAINT fk_msg_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_msg_reply FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 消息已读表：记录用户对某条消息的已读状态
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_reads (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      message_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE INDEX idx_msg_user (message_id, user_id),
      INDEX idx_user (user_id),
      CONSTRAINT fk_read_msg FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      CONSTRAINT fk_read_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 用户封禁表：记录封禁原因、范围（全局/房间级）、过期时间
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_bans (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      banned_by BIGINT UNSIGNED NOT NULL,
      reason VARCHAR(500) NOT NULL,
      scope ENUM('global','room') NOT NULL DEFAULT 'global',
      room_id INT UNSIGNED DEFAULT NULL,
      expires_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_user_id (user_id),
      INDEX idx_user_scope (user_id, scope),
      INDEX idx_expires (expires_at),
      CONSTRAINT fk_ban_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ban_operator FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 审计日志表：记录管理员操作，便于安全审计追溯
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      operator_id BIGINT UNSIGNED NOT NULL,
      action ENUM('login','logout','kick','ban','unban','mute','unmute',
                  'room_create','room_delete','msg_delete','config_change') NOT NULL,
      target_type ENUM('user','room','message') DEFAULT NULL,
      target_id BIGINT UNSIGNED DEFAULT NULL,
      detail JSON DEFAULT NULL,
      ip_address VARCHAR(45) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_operator (operator_id),
      INDEX idx_action (action),
      INDEX idx_created (created_at),
      CONSTRAINT fk_audit_operator FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 如果房间表为空，插入三个默认公共频道
  const [existing] = await pool.query('SELECT COUNT(*) AS cnt FROM rooms');
  if (existing[0].cnt === 0) {
    await pool.query(`
      INSERT INTO rooms (name, display_name, description, type, status) VALUES
        ('room1', '大厅', '默认公共聊天频道', 'public', 'active'),
        ('room2', '技术交流', '技术讨论专用频道', 'public', 'active'),
        ('room3', '休闲水区', '轻松闲聊频道', 'public', 'active')
    `);
  }
}

// 通用查询方法，对外暴露连接池的 query 接口
async function query(sql, params) {
  return getPool().query(sql, params);
}

module.exports = { getPool, isAvailable, setUnavailable, ensureSchema, query };
