// password.js — 密码哈希与验证工具
// 使用 bcrypt 进行安全的密码哈希存储和比对
const bcrypt = require('bcrypt');
// 哈希计算轮数，10 是性能与安全性的平衡值
const SALT_ROUNDS = 10;

// 将明文密码哈希为 bcrypt 哈希字符串
async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

// 比对明文密码与已存储的哈希是否匹配
async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, comparePassword };
