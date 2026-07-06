-- Basic schema for realtime chatrooms
CREATE DATABASE IF NOT EXISTS chat_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE chat_app;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  channel VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_channel_created_at (channel, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;