// auth.js - 登录/注册/鉴权逻辑
(function() {
  const TOKEN_KEY = 'chat-token';
  const USER_KEY = 'chat-user';

  window.ChatAuth = {
    getToken() { return localStorage.getItem(TOKEN_KEY); },
    getUser() {
      try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
    },
    setSession(token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    clearSession() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
    isLoggedIn() { return !!this.getToken(); },
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

  // Login page logic
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  if (loginForm) {
    if (ChatAuth.isLoggedIn()) {
      location.href = '/chat.html';
      return;
    }

    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        loginForm.style.display = target === 'login' ? '' : 'none';
        registerForm.style.display = target === 'register' ? '' : 'none';
      });
    });

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      if (!username || !password) { errEl.textContent = '请填写用户名和密码'; return; }
      try {
        const data = await ChatAuth.apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        ChatAuth.setSession(data.token, data.user);
        location.href = '/chat.html';
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('reg-error');
      errEl.textContent = '';
      const username = document.getElementById('reg-username').value.trim();
      const nickname = document.getElementById('reg-nickname').value.trim();
      const password = document.getElementById('reg-password').value;
      const password2 = document.getElementById('reg-password2').value;
      if (!username || !password) { errEl.textContent = '请填写用户名和密码'; return; }
      if (password !== password2) { errEl.textContent = '两次密码不一致'; return; }
      try {
        const data = await ChatAuth.apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, password, nickname })
        });
        ChatAuth.setSession(data.token, data.user);
        location.href = '/chat.html';
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  // Chat/Admin page: check auth
  if (location.pathname === '/chat.html' || location.pathname === '/admin.html') {
    if (!ChatAuth.isLoggedIn()) {
      location.href = '/index.html';
      return;
    }
  }
})();
