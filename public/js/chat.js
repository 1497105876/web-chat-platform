// 文件说明：chat.js - 聊天界面核心逻辑
// 负责消息展示、发送、回复、撤回、删除、在线用户列表、表情面板等功能
// 依赖：ChatAuth（鉴权）、ChatWS（WebSocket 通信）、ChatRoom（频道管理）
(function() {
  // 获取页面 DOM 元素引用
  const logEl = document.getElementById('log');                     // 消息列表容器
  const onlineListEl = document.getElementById('online-list');      // 在线用户列表
  const onlineCountEl = document.getElementById('online-count');    // 顶部在线人数
  const onlineCount2El = document.getElementById('online-count-2'); // 侧栏在线人数
  const statusText = document.getElementById('info');               // 连接状态文字
  const chatForm = document.getElementById('chat-form');            // 消息输入表单
  const messageInput = document.getElementById('message');          // 消息输入框
  const userDisplay = document.getElementById('user-display');      // 顶部用户显示
  const adminBtn = document.getElementById('admin-btn');            // 管理后台入口按钮
  const logoutBtn = document.getElementById('logout-btn');          // 退出登录按钮
  const replyPreview = document.getElementById('reply-preview');    // 回复预览条
  const replyText = document.getElementById('reply-text');          // 回复预览文字
  const replyCancel = document.getElementById('reply-cancel');      // 取消回复按钮

  // 消息计数器（用于可能的性能优化或限制）
  let messageCount = 0;
  // 当前回复的目标消息 ID（null 表示非回复状态）
  let replyToId = null;

  // 获取当前登录用户信息，更新顶部显示
  const user = ChatAuth.getUser();
  if (user) {
    userDisplay.textContent = user.nickname || user.username;
    // 管理员或超级管理员显示管理后台入口按钮
    if (user.role === 'admin' || user.role === 'super_admin') {
      adminBtn.style.display = '';
    }
  }

  // ===== 消息渲染函数 =====
  // 将一条消息渲染为 DOM 元素并追加到消息列表
  // 参数包含：消息类型、用户名、内容、内容类型、回复引用、创建时间、消息 ID
  function appendMessage({ type, username, content, contentType, replyTo, createdAt, id }) {
    const wrapper = document.createElement('div');
    // 系统消息使用特殊样式
    wrapper.className = type === 'system' ? 'message system' : 'message';
    if (id) wrapper.dataset.msgId = id;

    // 消息元信息行：用户名 + 时间
    const meta = document.createElement('div');
    meta.className = 'meta';
    const userEl = document.createElement('span');
    userEl.className = 'user';
    userEl.textContent = type === 'system' ? '系统' : username;
    const timeEl = document.createElement('span');
    timeEl.className = 'time';
    timeEl.textContent = createdAt ? new Date(createdAt).toLocaleTimeString() : '';
    meta.append(userEl, timeEl);

    // 消息正文区域
    const body = document.createElement('div');
    body.className = 'body';

    // 如果是回复消息，显示被回复消息的引用预览
    if (replyTo) {
      const replyRef = document.createElement('div');
      replyRef.className = 'reply-ref';
      replyRef.textContent = `${replyTo.username}: ${(replyTo.preview || '').slice(0, 80)}`;
      body.appendChild(replyRef);
    }

    // 根据内容类型渲染消息正文
    if (contentType === 'image' && content?.url) {
      // 图片消息：创建 img 元素，懒加载
      const img = document.createElement('img');
      img.src = content.url;
      img.loading = 'lazy';
      body.appendChild(img);
    } else if (content?.text) {
      // 文本消息：使用 createTextNode 防止 XSS
      body.appendChild(document.createTextNode(content.text));
    } else if (typeof content === 'string') {
      // 纯字符串内容（兼容旧格式）
      body.appendChild(document.createTextNode(content));
    }

    // 非系统消息且有自己的 ID 时，添加操作按钮（回复、撤回、删除）
    if (type !== 'system' && id) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'msg-actions';

      // 回复按钮：所有用户均可回复
      const replyBtn = document.createElement('button');
      replyBtn.className = 'reply-btn';
      replyBtn.textContent = '回复';
      replyBtn.addEventListener('click', () => {
        replyToId = id;
        // 构建回复预览文字
        const preview = content?.text ? content.text.slice(0, 60) : (contentType === 'image' ? '[图片]' : '...');
        replyText.textContent = `回复 ${username}: ${preview}`;
        replyPreview.style.display = '';
        messageInput.focus();
      });
      actionsEl.appendChild(replyBtn);

      // 撤回按钮：仅普通用户自己的消息，且在发送后 2 分钟内可撤回
      // 管理员不显示撤回按钮，用删除代替
      const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');
      if (user && username === user.username && createdAt && !isAdmin) {
        const elapsed = Date.now() - new Date(createdAt).getTime();
        if (elapsed < 2 * 60 * 1000) {
          const recallBtn = document.createElement('button');
          recallBtn.className = 'reply-btn';
          recallBtn.textContent = '撤回';
          recallBtn.addEventListener('click', () => {
            if (!confirm('确认撤回这条消息？')) return;
            ChatWS.send({ type: 'recall', messageId: id });
          });
          actionsEl.appendChild(recallBtn);

          // 2 分钟到期后自动移除撤回按钮
          const remaining = 2 * 60 * 1000 - elapsed;
          setTimeout(() => {
            if (recallBtn.parentNode) recallBtn.remove();
          }, remaining);
        }
      }

      // 管理员删除按钮：admin 和 super_admin 可删除任何用户的消息
      if (user && (user.role === 'admin' || user.role === 'super_admin')) {
        const delBtn = document.createElement('button');
        delBtn.className = 'reply-btn btn-danger';
        delBtn.textContent = '删除';
        delBtn.addEventListener('click', () => {
          if (!confirm('确认删除这条消息？')) return;
          ChatWS.send({ type: 'admin:delete_msg', messageId: id });
        });
        actionsEl.appendChild(delBtn);
      }

      meta.appendChild(actionsEl);
    }

    // 组装消息元素并追加到列表，自动滚动到底部
    wrapper.append(meta, body);
    logEl.appendChild(wrapper);
    logEl.scrollTop = logEl.scrollHeight;
    messageCount++;
  }

  // ===== 在线用户列表更新 =====
  function setOnlineList(users) {
    onlineListEl.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      li.textContent = u;
      onlineListEl.appendChild(li);
    });
    // 更新顶部和侧栏的在线人数显示
    onlineCountEl.textContent = `${users.length} 在线`;
    if (onlineCount2El) onlineCount2El.textContent = users.length;
  }

  // 清空消息列表并重置计数器
  function clearLog() {
    logEl.innerHTML = '';
    messageCount = 0;
  }

  // ===== WebSocket 事件处理 =====

  // 连接成功：启用输入框和发送按钮，加入当前频道
  ChatWS.on('open', () => {
    statusText.textContent = '已连接';
    messageInput.disabled = false;
    chatForm.querySelector('button[type="submit"]').disabled = false;
    // 如果已选定了频道，连接后自动加入
    if (ChatRoom.current) {
      ChatWS.send({ type: 'join', channel: ChatRoom.current });
    }
  });

  // 连接关闭：禁用输入，认证失败则清除会话并跳转登录页
  ChatWS.on('close', (data) => {
    statusText.textContent = data.code === 4001 ? '认证失败，请重新登录' : '已断开，正在重连...';
    messageInput.disabled = true;
    chatForm.querySelector('button[type="submit"]').disabled = true;
    // 4001 = token 无效或过期
    if (data.code === 4001) {
      ChatAuth.clearSession();
      location.href = '/index.html';
    }
  });

  // 收到历史消息：清空当前列表后批量渲染（切换频道时触发）
  ChatWS.on('history', (payload) => {
    clearLog();
    (payload.messages || []).forEach(msg => appendMessage({
      type: 'chat',
      id: msg.id,
      username: msg.username,
      content: msg.content,
      contentType: msg.contentType,
      replyTo: msg.replyTo,
      createdAt: msg.createdAt
    }));
    statusText.textContent = `已连接到 ${ChatRoom.current}`;
  });

  // 收到新聊天消息：实时追加到消息列表
  ChatWS.on('chat', (payload) => {
    appendMessage({
      type: 'chat',
      id: payload.id,
      username: payload.username,
      content: payload.content,
      contentType: payload.contentType,
      replyTo: payload.replyTo,
      createdAt: payload.createdAt
    });
  });

  // 系统消息：用户加入/离开频道等
  ChatWS.on('system', (payload) => {
    appendMessage({
      type: 'system',
      content: { text: payload.message },
      createdAt: payload.createdAt || new Date().toISOString()
    });
  });

  // 在线用户列表更新
  ChatWS.on('users', (payload) => {
    setOnlineList(payload.users || []);
  });

  // 错误消息
  ChatWS.on('error', (payload) => {
    appendMessage({
      type: 'system',
      content: { text: payload.message || '错误' },
      createdAt: new Date().toISOString()
    });
  });

  // 消息被撤回/删除：将消息内容替换为提示文字并禁用交互
  ChatWS.on('msg_deleted', (payload) => {
    const msgEl = logEl.querySelector(`[data-msg-id="${payload.messageId}"]`);
    if (msgEl) {
      msgEl.style.opacity = '0.3';
      msgEl.style.pointerEvents = 'none';
      const body = msgEl.querySelector('.body');
      if (body) body.textContent = '[消息已撤回]';
      const actions = msgEl.querySelector('.msg-actions');
      if (actions) actions.remove();
    }
  });

  // 被踢出：显示提示后断开连接并跳转登录页
  ChatWS.on('kicked', (payload) => {
    appendMessage({
      type: 'system',
      content: { text: payload.message || '你已被踢出' },
      createdAt: new Date().toISOString()
    });
    ChatWS.close();
    setTimeout(() => { location.href = '/index.html'; }, 2000);
  });

  // 被封禁：显示提示后断开连接并跳转登录页
  ChatWS.on('banned', (payload) => {
    appendMessage({
      type: 'system',
      content: { text: payload.message || '你已被封禁' },
      createdAt: new Date().toISOString()
    });
    ChatWS.close();
    setTimeout(() => { location.href = '/index.html'; }, 2000);
  });

  // ===== 消息发送表单提交 =====
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    // 未连接时不发送
    if (!ChatWS.connected) return;
    const content = messageInput.value.trim();
    if (!content) return;
    // 构建消息数据，如果有回复目标则带上 replyTo
    const data = { type: 'chat', content: { text: content }, contentType: 'text' };
    if (replyToId) { data.replyTo = replyToId; replyToId = null; replyPreview.style.display = 'none'; }
    ChatWS.send(data);
    messageInput.value = '';
  });

  // 取消回复预览
  if (replyCancel) {
    replyCancel.addEventListener('click', () => {
      replyToId = null;
      replyPreview.style.display = 'none';
    });
  }

  // 退出登录：通知后端、清除本地会话、断开 WebSocket、跳转登录页
  logoutBtn.addEventListener('click', async () => {
    try { await ChatAuth.apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    ChatAuth.clearSession();
    ChatWS.close();
    location.href = '/index.html';
  });

  // ===== 表情面板功能 =====
  const emojiBtn = document.getElementById('emoji-btn');
  const emojiPanel = document.getElementById('emoji-panel');
  // 预定义的表情列表
  const emojiList = [
    '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗',
    '😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐',
    '😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑',
    '😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰',
    '😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇',
    '🥳','🥺','🤠','🤡','🤥','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','👻','👽',
    '🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾'
  ];

  if (emojiBtn && emojiPanel) {
    // 点击表情按钮：切换面板显示/隐藏
    emojiBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // 面板已显示则关闭
      if (emojiPanel.style.display === 'block') { emojiPanel.style.display = 'none'; return; }
      // 动态生成表情按钮
      emojiPanel.innerHTML = '';
      emojiList.forEach(emoji => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = emoji;
        btn.className = 'emoji-item';
        // 点击表情：插入到输入框光标位置
        btn.addEventListener('click', () => {
          const start = messageInput.selectionStart;
          const end = messageInput.selectionEnd;
          messageInput.value = messageInput.value.slice(0, start) + emoji + messageInput.value.slice(end);
          messageInput.focus();
          // 恢复光标位置到插入的表情之后
          messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
          emojiPanel.style.display = 'none';
        });
        emojiPanel.appendChild(btn);
      });
      // 定位表情面板到按钮上方
      const rect = emojiBtn.getBoundingClientRect();
      emojiPanel.style.left = rect.left + 'px';
      emojiPanel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      emojiPanel.style.display = 'block';
    });
    // 点击面板外部时关闭表情面板
    document.addEventListener('click', (e) => {
      if (emojiPanel.style.display === 'block' && !emojiPanel.contains(e.target) && e.target !== emojiBtn) {
        emojiPanel.style.display = 'none';
      }
    });
  }

  // ===== 初始化：先初始化房间模块，再建立 WebSocket 连接 =====
  ChatRoom.init();
  ChatWS.connect();
})();
