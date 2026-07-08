// chat.js - 聊天界面逻辑
(function() {
  const logEl = document.getElementById('log');
  const onlineListEl = document.getElementById('online-list');
  const onlineCountEl = document.getElementById('online-count');
  const onlineCount2El = document.getElementById('online-count-2');
  const statusText = document.getElementById('info');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message');
  const userDisplay = document.getElementById('user-display');
  const adminBtn = document.getElementById('admin-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const replyPreview = document.getElementById('reply-preview');
  const replyText = document.getElementById('reply-text');
  const replyCancel = document.getElementById('reply-cancel');

  let messageCount = 0;
  let replyToId = null;

  const user = ChatAuth.getUser();
  if (user) {
    userDisplay.textContent = user.nickname || user.username;
    if (user.role === 'admin' || user.role === 'super_admin') {
      adminBtn.style.display = '';
    }
  }

  function appendMessage({ type, username, content, contentType, replyTo, createdAt, id }) {
    const wrapper = document.createElement('div');
    wrapper.className = type === 'system' ? 'message system' : 'message';
    if (id) wrapper.dataset.msgId = id;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const userEl = document.createElement('span');
    userEl.className = 'user';
    userEl.textContent = type === 'system' ? '系统' : username;
    const timeEl = document.createElement('span');
    timeEl.className = 'time';
    timeEl.textContent = createdAt ? new Date(createdAt).toLocaleTimeString() : '';
    meta.append(userEl, timeEl);

    const body = document.createElement('div');
    body.className = 'body';

    if (replyTo) {
      const replyRef = document.createElement('div');
      replyRef.className = 'reply-ref';
      replyRef.textContent = `${replyTo.username}: ${(replyTo.preview || '').slice(0, 80)}`;
      body.appendChild(replyRef);
    }

    if (contentType === 'image' && content?.url) {
      const img = document.createElement('img');
      img.src = content.url;
      img.loading = 'lazy';
      body.appendChild(img);
    } else if (content?.text) {
      body.appendChild(document.createTextNode(content.text));
    } else if (typeof content === 'string') {
      body.appendChild(document.createTextNode(content));
    }

    if (type !== 'system' && id) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'msg-actions';

      const replyBtn = document.createElement('button');
      replyBtn.className = 'reply-btn';
      replyBtn.textContent = '回复';
      replyBtn.addEventListener('click', () => {
        replyToId = id;
        const preview = content?.text ? content.text.slice(0, 60) : (contentType === 'image' ? '[图片]' : '...');
        replyText.textContent = `回复 ${username}: ${preview}`;
        replyPreview.style.display = '';
        messageInput.focus();
      });
      actionsEl.appendChild(replyBtn);

      // 撤回按钮：仅自己的消息，2 分钟内
      if (user && username === user.username && createdAt) {
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

          const remaining = 2 * 60 * 1000 - elapsed;
          setTimeout(() => {
            if (recallBtn.parentNode) recallBtn.remove();
          }, remaining);
        }
      }

      // 管理员删除按钮
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

    wrapper.append(meta, body);
    logEl.appendChild(wrapper);
    logEl.scrollTop = logEl.scrollHeight;
    messageCount++;
  }

  function setOnlineList(users) {
    onlineListEl.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      li.textContent = u;
      onlineListEl.appendChild(li);
    });
    onlineCountEl.textContent = `${users.length} 在线`;
    if (onlineCount2El) onlineCount2El.textContent = users.length;
  }

  function clearLog() {
    logEl.innerHTML = '';
    messageCount = 0;
  }

  ChatWS.on('open', () => {
    statusText.textContent = '已连接';
    messageInput.disabled = false;
    chatForm.querySelector('button[type="submit"]').disabled = false;
    if (ChatRoom.current) {
      ChatWS.send({ type: 'join', channel: ChatRoom.current });
    }
  });

  ChatWS.on('close', (data) => {
    statusText.textContent = data.code === 4001 ? '认证失败，请重新登录' : '已断开，正在重连...';
    messageInput.disabled = true;
    chatForm.querySelector('button[type="submit"]').disabled = true;
    if (data.code === 4001) {
      ChatAuth.clearSession();
      location.href = '/index.html';
    }
  });

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

  ChatWS.on('system', (payload) => {
    appendMessage({
      type: 'system',
      content: { text: payload.message },
      createdAt: payload.createdAt || new Date().toISOString()
    });
  });

  ChatWS.on('users', (payload) => {
    setOnlineList(payload.users || []);
  });

  ChatWS.on('error', (payload) => {
    appendMessage({
      type: 'system',
      content: { text: payload.message || '错误' },
      createdAt: new Date().toISOString()
    });
  });

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

  ChatWS.on('kicked', (payload) => {
    appendMessage({
      type: 'system',
      content: { text: payload.message || '你已被踢出' },
      createdAt: new Date().toISOString()
    });
    ChatWS.close();
    setTimeout(() => { location.href = '/index.html'; }, 2000);
  });

  ChatWS.on('banned', (payload) => {
    appendMessage({
      type: 'system',
      content: { text: payload.message || '你已被封禁' },
      createdAt: new Date().toISOString()
    });
    ChatWS.close();
    setTimeout(() => { location.href = '/index.html'; }, 2000);
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ChatWS.connected) return;
    const content = messageInput.value.trim();
    if (!content) return;
    const data = { type: 'chat', content: { text: content }, contentType: 'text' };
    if (replyToId) { data.replyTo = replyToId; replyToId = null; replyPreview.style.display = 'none'; }
    ChatWS.send(data);
    messageInput.value = '';
  });

  if (replyCancel) {
    replyCancel.addEventListener('click', () => {
      replyToId = null;
      replyPreview.style.display = 'none';
    });
  }

  logoutBtn.addEventListener('click', async () => {
    try { await ChatAuth.apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    ChatAuth.clearSession();
    ChatWS.close();
    location.href = '/index.html';
  });

  // Emoji
  const emojiBtn = document.getElementById('emoji-btn');
  const emojiPanel = document.getElementById('emoji-panel');
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
    emojiBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (emojiPanel.style.display === 'block') { emojiPanel.style.display = 'none'; return; }
      emojiPanel.innerHTML = '';
      emojiList.forEach(emoji => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = emoji;
        btn.className = 'emoji-item';
        btn.addEventListener('click', () => {
          const start = messageInput.selectionStart;
          const end = messageInput.selectionEnd;
          messageInput.value = messageInput.value.slice(0, start) + emoji + messageInput.value.slice(end);
          messageInput.focus();
          messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
          emojiPanel.style.display = 'none';
        });
        emojiPanel.appendChild(btn);
      });
      const rect = emojiBtn.getBoundingClientRect();
      emojiPanel.style.left = rect.left + 'px';
      emojiPanel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      emojiPanel.style.display = 'block';
    });
    document.addEventListener('click', (e) => {
      if (emojiPanel.style.display === 'block' && !emojiPanel.contains(e.target) && e.target !== emojiBtn) {
        emojiPanel.style.display = 'none';
      }
    });
  }

  // Init
  ChatRoom.init();
  ChatWS.connect();
})();
