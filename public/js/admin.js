// 文件说明：admin.js - 管理后台核心逻辑
// 包含用户管理（查看、角色调整、封禁/解封）和审计日志查看功能
// 依赖：ChatAuth（鉴权）、ChatWS（WebSocket 通信）
(function() {
  // 获取当前登录用户信息
  const user = ChatAuth.getUser();
  // 权限守卫：非管理员或超级管理员不允许访问管理后台，重定向到聊天页
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    location.href = '/chat.html';
    return;
  }

  // 是否为超级管理员（拥有最高权限，可以调整其他管理员的角色）
  const isSuperAdmin = user.role === 'super_admin';
  // 角色权限等级映射：数值越大权限越高，用于判断是否可对目标用户执行操作
  const HIERARCHY = { super_admin: 3, admin: 2, user: 1 };

  // 顶部显示当前管理员信息
  const adminUserEl = document.getElementById('admin-user');
  adminUserEl.textContent = (user.nickname || user.username) + (isSuperAdmin ? ' (超级管理员)' : ' (管理员)');

  // 当前激活的标签页（users 或 logs）
  let currentTab = 'users';
  // 用户列表当前页码
  let userPage = 1;

  // ===== 标签页切换逻辑 =====
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // 切换标签激活状态
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      // 显示对应标签页内容，隐藏另一个
      document.getElementById('tab-users').style.display = currentTab === 'users' ? '' : 'none';
      document.getElementById('tab-logs').style.display = currentTab === 'logs' ? '' : 'none';
      // 切换到对应标签页时加载数据
      if (currentTab === 'users') loadUsers();
      if (currentTab === 'logs') loadLogs();
    });
  });

  // ===== 用户管理 =====
  // 加载用户列表，支持分页和搜索
  async function loadUsers(page = 1, search = '') {
    userPage = page;
    try {
      // 构建查询参数：页码、每页数量、搜索关键词
      const params = new URLSearchParams({ page, pageSize: 20 });
      if (search) params.set('search', search);
      const data = await ChatAuth.apiFetch(`/api/admin/users?${params}`);
      const tbody = document.getElementById('user-table-body');
      tbody.innerHTML = '';
      // 遍历用户数据，生成表格行
      data.users.forEach(u => {
        // 判断是否为当前登录用户自己
        const isSelf = u.id === user.id;
        // 权限判断：不能操作自己，且当前用户权限等级需高于目标用户
        const canOperate = !isSelf && (HIERARCHY[user.role] || 0) > (HIERARCHY[u.role] || 0);

        // 根据权限和目标用户状态生成操作按钮
        let actions = '';
        if (isSelf) {
          actions = '<span class="muted">当前用户</span>';
        } else if (!canOperate) {
          actions = '<span class="muted">无权操作</span>';
        } else {
          const buttons = [];
          // 仅超级管理员可提升/降级管理员角色
          if (isSuperAdmin && u.role === 'user') {
            buttons.push(`<button class="ghost btn-sm" onclick="adminSetRole(${u.id}, 'admin')">提权</button>`);
          }
          if (isSuperAdmin && u.role === 'admin') {
            buttons.push(`<button class="ghost btn-sm" onclick="adminSetRole(${u.id}, 'user')">降权</button>`);
          }
          // 未被封禁的用户显示封禁按钮
          if (u.status !== 'banned') {
            buttons.push(`<button class="ghost btn-sm btn-danger" onclick="adminBan(${u.id})">封禁</button>`);
          }
          // 已被封禁的用户显示解封按钮
          if (u.status === 'banned') {
            buttons.push(`<button class="ghost btn-sm" onclick="adminUnbanUser(${u.id})">解封</button>`);
          }
          actions = buttons.join('');
        }

        // 构建表格行 HTML
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
      // 渲染分页控件
      renderPagination('user-pagination', data.total, page, 20, (p) => loadUsers(p, search));
    } catch (err) {
      console.error('加载用户列表失败:', err);
    }
  }

  // 设置用户角色（提权/降权），暴露到全局供 onclick 调用
  window.adminSetRole = async function(userId, newRole) {
    try {
      await ChatAuth.apiFetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT', body: JSON.stringify({ role: newRole })
      });
      // 操作成功后刷新当前页
      loadUsers(userPage, document.getElementById('user-search').value.trim());
    } catch (err) { alert(err.message); }
  };

  // 打开封禁模态框，暴露到全局供 onclick 调用
  window.adminBan = function(userId) {
    document.getElementById('ban-user-id').value = userId;
    document.getElementById('ban-reason').value = '';
    document.getElementById('ban-expires').value = '';
    document.getElementById('ban-modal').style.display = '';
  };

  // 解封用户，暴露到全局供 onclick 调用
  window.adminUnbanUser = async function(userId) {
    try {
      await ChatAuth.apiFetch(`/api/admin/unban-by-user/${userId}`, { method: 'DELETE' });
      loadUsers(userPage, document.getElementById('user-search').value.trim());
    } catch (err) { alert(err.message); }
  };

  // 封禁确认按钮：提交封禁请求到后端
  document.getElementById('ban-confirm').addEventListener('click', async () => {
    const userId = parseInt(document.getElementById('ban-user-id').value);
    const reason = document.getElementById('ban-reason').value.trim();
    const expires = document.getElementById('ban-expires').value;
    // 封禁原因必填
    if (!reason) { alert('请输入封禁原因'); return; }
    try {
      await ChatAuth.apiFetch('/api/admin/ban', {
        method: 'POST',
        body: JSON.stringify({ userId, reason, expiresAt: expires || null })
      });
      // 封禁成功后关闭模态框并刷新列表
      document.getElementById('ban-modal').style.display = 'none';
      loadUsers(userPage, document.getElementById('user-search').value.trim());
    } catch (err) { alert(err.message); }
  });

  // 封禁模态框关闭按钮
  document.getElementById('ban-modal-close').addEventListener('click', () => {
    document.getElementById('ban-modal').style.display = 'none';
  });

  // 用户搜索按钮
  document.getElementById('user-search-btn').addEventListener('click', () => {
    loadUsers(1, document.getElementById('user-search').value.trim());
  });

  // 搜索框回车键触发搜索
  document.getElementById('user-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadUsers(1, e.target.value.trim());
  });

  // ===== 审计日志 =====
  // 加载审计日志，支持分页和按操作类型筛选
  async function loadLogs(page = 1, action = '') {
    try {
      const params = new URLSearchParams({ page, pageSize: 50 });
      if (action) params.set('action', action);
      const data = await ChatAuth.apiFetch(`/api/admin/logs?${params}`);
      const tbody = document.getElementById('log-table-body');
      tbody.innerHTML = '';
      // 遍历日志数据，生成表格行
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
      // 简易分页总数估算（当返回满 50 条时认为还有下一页）
      const total = data.logs.length >= 50 ? (page + 1) * 50 - 1 : page * 50;
      renderPagination('log-pagination', total, page, 50, (p) => loadLogs(p, action));
    } catch (err) {
      console.error('获取审计日志失败:', err);
    }
  }

  // 日志筛选按钮
  document.getElementById('log-filter-btn').addEventListener('click', () => {
    loadLogs(1, document.getElementById('log-action-filter').value);
  });

  // ===== 分页控件渲染 =====
  // 通用分页组件：根据总数和每页大小生成页码按钮
  function renderPagination(elId, total, current, pageSize, onPage) {
    const el = document.getElementById(elId);
    if (!el) return;
    const totalPages = Math.ceil(total / pageSize);
    el.innerHTML = '';
    // 只有一页时不显示分页
    if (totalPages <= 1) return;
    // 最多显示前 10 页的页码按钮
    for (let i = 1; i <= Math.min(totalPages, 10); i++) {
      const btn = document.createElement('button');
      btn.className = i === current ? 'primary btn-sm' : 'ghost btn-sm';
      btn.textContent = i;
      btn.addEventListener('click', () => onPage(i));
      el.appendChild(btn);
    }
  }

  // HTML 转义工具函数：防止 XSS 攻击
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // 页面加载完成后默认加载用户列表
  loadUsers();
})();
