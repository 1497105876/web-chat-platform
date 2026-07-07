const mysql = require('mysql2/promise');

let pool = null;
let dbAvailable = true;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'chat_app',
      connectionLimit: 10,
      timezone: 'Z'
    });
  }
  return pool;
}

function isAvailable() { return dbAvailable; }
function setUnavailable() { dbAvailable = false; }

async function ensureSchema() {
  const pool = getPool();

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

  // Seed default rooms if empty
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

async function query(sql, params) {
  return getPool().query(sql, params);
}

module.exports = { getPool, isAvailable, setUnavailable, ensureSchema, query };
