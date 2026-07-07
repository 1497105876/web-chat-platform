const db = require('../db');

async function log({ operatorId, action, targetType = null, targetId = null, detail = null, ipAddress }) {
  if (!db.isAvailable()) return;
  await db.query(
    `INSERT INTO audit_logs (operator_id, action, target_type, target_id, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?)`,
    [operatorId, action, targetType, targetId, detail ? JSON.stringify(detail) : null, ipAddress]
  );
}

async function getLogs({ page = 1, pageSize = 50, action = null, operatorId = null } = {}) {
  if (!db.isAvailable()) return [];
  let where = '1=1';
  const params = [];
  if (action) { where += ' AND a.action = ?'; params.push(action); }
  if (operatorId) { where += ' AND a.operator_id = ?'; params.push(operatorId); }
  const offset = (page - 1) * pageSize;
  const [rows] = await db.query(
    `SELECT a.*, u.username AS operator_name
     FROM audit_logs a
     LEFT JOIN users u ON a.operator_id = u.id
     WHERE ${where}
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  return rows;
}

module.exports = { log, getLogs };
