// admin.js - 管理后台逻辑
(function() {
  const user = ChatAuth.getUser();
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    location.href = '/chat.html';
    return;
  }

  const isSuperAdmin = user.role === 'super_admin';
  const HIERARCHY = { super_admin: 3, admin: 2, user: 1 };

  const adminUserEl = document.getElementById('admin-user');
  adminUserEl.textContent = (user.nickname || user.username) + (isSuperAdmin ? ' (超级管理员)' : ' (管理员)');

  let currentTab = 'users';
  let userPage = 1;

  // Tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      document.getElementById('tab-users').style.display = currentTab === 'users' ? '' : 'none';
      document.getElementById('tab-logs').style.display = currentTab === 'logs' ? '' : 'none';
      if (currentTab === 'users') loadUsers();
      if (currentTab === 'logs') loadLogs();
    });
  });

  // User management
  async function loadUsers(page = 1, search = '') {
    userPage = page;
    try {
      const params = new URLSearchParams({ page, pageSize: 20 });
      if (search) params.set('search', search);
      const data = await ChatAuth.apiFetch(`/api/admin/users?${params}`);
      const tbody = document.getElementById('user-table-body');
      tbody.innerHTML = '';
      data.users.forEach(u => {
        const isSelf = u.id === user.id;
        const canOperate = !isSelf && (HIERARCHY[user.role] || 0) > (HIERARCHY[u.role] || 0);

        let actions = '';
        if (isSelf) {
          actions = '<span class="muted">当前用户</span>';
        } else if (!canOperate) {
          actions = '<span class="muted">无权操作</span>';
        } else {
          const buttons = [];
          // 仅 super_admin 可提权/降权
          if (isSuperAdmin && u.role === 'user') {
            buttons.push(`<button class="ghost btn-sm" onclick="adminSetRole(${u.id}, 'admin')">提权</button>`);
          }
          if (isSuperAdmin && u.role === 'admin') {
            buttons.push(`<button class="ghost btn-sm" onclick="adminSetRole(${u.id}, 'user')">降权</button>`);
          }
          if (u.status !== 'banned') {
            buttons.push(`<button class="ghost btn-sm btn-danger" onclick="adminBan(${u.id})">封禁</button>`);
          }
          if (u.status === 'banned') {
            buttons.push(`<button class="ghost btn-sm" onclick="adminUnbanUser(${u.id})">解封</button>`);
          }
          actions = buttons.join('');
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${u.id}</td>
          <td>${esc(u.username)}</td>
          <td>${esc(u.nickname)}</td>
          <td><span class="badge badge-${u.role}">${u.role}</span></td>
          <td><span class="badge badge-${u.status}">${u.status}</span></td>
          <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
          <td class="actions-cell">${actions}</td>`;
        tbody.appendChild(tr);
      });
      renderPagination('user-pagination', data.total, page, 20, (p) => loadUsers(p, search));
    } catch (err) {
      console.error('加载用户列表失败:', err);
    }
  }

  window.adminSetRole = async function(userId, newRole) {
    try {
      await ChatAuth.apiFetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT', body: JSON.stringify({ role: newRole })
      });
      loadUsers(userPage, document.getElementById('user-search').value.trim());
    } catch (err) { alert(err.message); }
  };

  window.adminBan = function(userId) {
    document.getElementById('ban-user-id').value = userId;
    document.getElementById('ban-reason').value = '';
    document.getElementById('ban-expires').value = '';
    document.getElementById('ban-modal').style.display = '';
  };

  window.adminUnbanUser = async function(userId) {
    try {
      await ChatAuth.apiFetch(`/api/admin/unban-by-user/${userId}`, { method: 'DELETE' });
      loadUsers(userPage, document.getElementById('user-search').value.trim());
    } catch (err) { alert(err.message); }
  };

  document.getElementById('ban-confirm').addEventListener('click', async () => {
    const userId = parseInt(document.getElementById('ban-user-id').value);
    const reason = document.getElementById('ban-reason').value.trim();
    const expires = document.getElementById('ban-expires').value;
    if (!reason) { alert('请输入封禁原因'); return; }
    try {
      await ChatAuth.apiFetch('/api/admin/ban', {
        method: 'POST',
        body: JSON.stringify({ userId, reason, expiresAt: expires || null })
      });
      document.getElementById('ban-modal').style.display = 'none';
      loadUsers(userPage, document.getElementById('user-search').value.trim());
    } catch (err) { alert(err.message); }
  });

  document.getElementById('ban-modal-close').addEventListener('click', () => {
    document.getElementById('ban-modal').style.display = 'none';
  });

  document.getElementById('user-search-btn').addEventListener('click', () => {
    loadUsers(1, document.getElementById('user-search').value.trim());
  });

  document.getElementById('user-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadUsers(1, e.target.value.trim());
  });

  // Audit logs
  async function loadLogs(page = 1, action = '') {
    try {
      const params = new URLSearchParams({ page, pageSize: 50 });
      if (action) params.set('action', action);
      const data = await ChatAuth.apiFetch(`/api/admin/logs?${params}`);
      const tbody = document.getElementById('log-table-body');
      tbody.innerHTML = '';
      data.logs.forEach(l => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${l.id}</td>
          <td>${esc(l.operator_name || '-')}</td>
          <td><span class="badge badge-action">${l.action}</span></td>
          <td>${l.target_type || '-'}</td>
          <td>${l.target_id || '-'}</td>
          <td class="detail-cell">${l.detail ? esc(JSON.stringify(l.detail)).slice(0, 80) : '-'}</td>
          <td>${esc(l.ip_address)}</td>
          <td>${new Date(l.created_at).toLocaleString()}</td>`;
        tbody.appendChild(tr);
      });
      const total = data.logs.length >= 50 ? (page + 1) * 50 - 1 : page * 50;
      renderPagination('log-pagination', total, page, 50, (p) => loadLogs(p, action));
    } catch (err) {
      console.error('获取审计日志失败:', err);
    }
  }

  document.getElementById('log-filter-btn').addEventListener('click', () => {
    loadLogs(1, document.getElementById('log-action-filter').value);
  });

  function renderPagination(elId, total, current, pageSize, onPage) {
    const el = document.getElementById(elId);
    if (!el) return;
    const totalPages = Math.ceil(total / pageSize);
    el.innerHTML = '';
    if (totalPages <= 1) return;
    for (let i = 1; i <= Math.min(totalPages, 10); i++) {
      const btn = document.createElement('button');
      btn.className = i === current ? 'primary btn-sm' : 'ghost btn-sm';
      btn.textContent = i;
      btn.addEventListener('click', () => onPage(i));
      el.appendChild(btn);
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  loadUsers();
})();
