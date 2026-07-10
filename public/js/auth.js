// 文件说明：auth.js - 负责用户登录、注册、会话管理与鉴权逻辑
// 作为整个聊天系统的前端入口，管理 token 的存储与 API 请求的鉴权头注入
(function() {
  // localStorage 存储键名，分别用于保存 token 和用户信息
  const TOKEN_KEY = 'chat-token';
  const USER_KEY = 'chat-user';

  // 暴露到全局的认证模块，供其他脚本调用
  window.ChatAuth = {
    // 获取当前存储的 JWT token
    getToken() { return localStorage.getItem(TOKEN_KEY); },
    // 获取当前登录用户信息，解析失败时返回 null
    getUser() {
      try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
    },
    // 登录/注册成功后保存会话信息到 localStorage
    setSession(token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    // 退出登录时清除本地会话数据
    clearSession() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
    // 判断用户是否已登录（依据 token 是否存在）
    isLoggedIn() { return !!this.getToken(); },
    // 封装 fetch 请求，自动注入 Content-Type 和 Authorization 头
    // 统一处理错误响应，非 2xx 状态码抛出异常
    async apiFetch(url, options = {}) {
      const token = this.getToken();
      const headers = { 'Content-Type': 'application/json', ...options.headers };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { ...options, headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
  };

  // ===== 登录页面逻辑 =====
  // 获取登录和注册表单元素（仅在 index.html 中存在）
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  if (loginForm) {
    // 如果用户已登录，直接跳转到聊天页，避免重复登录
    if (ChatAuth.isLoggedIn()) {
      location.href = '/chat.html';
      return;
    }

    // 登录/注册标签页切换逻辑
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        // 移除所有标签的 active 状态
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // 根据点击的标签显示对应表单
        const target = tab.dataset.tab;
        loginForm.style.display = target === 'login' ? '' : 'none';
        registerForm.style.display = target === 'register' ? '' : 'none';
      });
    });

    // 登录表单提交处理
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      // 获取用户输入并去除首尾空白
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      // 前端基础校验：用户名和密码不能为空
      if (!username || !password) { errEl.textContent = '请填写用户名和密码'; return; }
      try {
        // 调用后端登录接口
        const data = await ChatAuth.apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        // 保存会话并跳转到聊天页
        ChatAuth.setSession(data.token, data.user);
        location.href = '/chat.html';
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    // 注册表单提交处理
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('reg-error');
      errEl.textContent = '';
      // 获取注册信息
      const username = document.getElementById('reg-username').value.trim();
      const nickname = document.getElementById('reg-nickname').value.trim();
      const password = document.getElementById('reg-password').value;
      const password2 = document.getElementById('reg-password2').value;
      // 前端基础校验
      if (!username || !password) { errEl.textContent = '请填写用户名和密码'; return; }
      // 两次密码必须一致
      if (password !== password2) { errEl.textContent = '两次密码不一致'; return; }
      try {
        // 调用后端注册接口
        const data = await ChatAuth.apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, password, nickname })
        });
        // 注册成功后自动登录并跳转
        ChatAuth.setSession(data.token, data.user);
        location.href = '/chat.html';
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  // ===== 聊天页/管理页鉴权守卫 =====
  // 如果用户未登录就访问聊天页或管理页，强制跳转回登录页
  if (location.pathname === '/chat.html' || location.pathname === '/admin.html') {
    if (!ChatAuth.isLoggedIn()) {
      location.href = '/index.html';
      return;
    }
  }
})();
