const logEl = document.getElementById('log');
const onlineListEl = document.getElementById('online-list');
const onlineCountEl = document.getElementById('online-count');
const messageCountEl = document.getElementById('message-count');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const infoEl = document.getElementById('info');

const usernameInput = document.getElementById('username');
const channelSelect = document.getElementById('channel');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message');

let socket = null;
let currentChannel = null;
let messageCount = 0;
let joined = false;

function wsUrl() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

function setStatus(connected) {
  statusDot.className = connected ? 'dot dot-on' : 'dot dot-off';
  statusText.textContent = connected ? '已连接' : '未连接';
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  messageInput.disabled = !connected;
  chatForm.querySelector('button[type="submit"]').disabled = !connected;
  usernameInput.disabled = connected;
  channelSelect.disabled = connected;
}

function clearLog() {
  logEl.innerHTML = '';
  messageCount = 0;
  updateCounters();
}

function updateCounters() {
  messageCountEl.textContent = messageCount;
}

function appendMessage({ type, username, content, createdAt }) {
  const wrapper = document.createElement('div');
  wrapper.className = type === 'system' ? 'message system' : 'message';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const userEl = document.createElement('span');
  userEl.className = 'user';
  userEl.textContent = type === 'system' ? '系统' : username;
  const timeEl = document.createElement('span');
  timeEl.textContent = createdAt ? new Date(createdAt).toLocaleTimeString() : '';
  meta.append(userEl, timeEl);

  const body = document.createElement('div');
  body.className = 'body';
  if (type === 'voice' && content) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = content;
    body.appendChild(audio);
  } else {
    body.textContent = content;
  }

  wrapper.append(meta, body);
  logEl.appendChild(wrapper);
  logEl.scrollTop = logEl.scrollHeight;
  messageCount += 1;
  updateCounters();
}

function setOnlineList(users) {
  onlineListEl.innerHTML = '';
  users.forEach((u) => {
    const li = document.createElement('li');
    li.textContent = u;
    onlineListEl.appendChild(li);
  });
  onlineCountEl.textContent = users.length;
}

function disconnect() {
  if (socket) {
    socket.close();
    socket = null;
  }
  setStatus(false);
  currentChannel = null;
  setOnlineList([]);
  infoEl.textContent = '';
}

function connect() {
  const username = usernameInput.value.trim();
  const channel = channelSelect.value;
  if (!username) {
    infoEl.textContent = '请输入昵称。';
    return;
  }
  disconnect();
  clearLog();
  joined = false;

  socket = new WebSocket(wsUrl());
  setStatus(false);
  infoEl.textContent = '正在连接...';

  socket.addEventListener('open', () => {
    currentChannel = channel;
    socket.send(
      JSON.stringify({ type: 'join', username, channel })
    );
  });

  socket.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (_err) {
      return;
    }

    switch (payload.type) {
      case 'history': {
        clearLog();
        (payload.messages || []).forEach((msg) => appendMessage({
          type: 'chat',
          username: msg.username,
          content: msg.content,
          createdAt: msg.createdAt
        }));
        joined = true;
        setStatus(true);
        infoEl.textContent = `已连接到 ${currentChannel || channelSelect.value}`;
        break;
      }
      case 'chat':
      case 'voice': {
        appendMessage(payload);
        break;
      }
      case 'system': {
        const msg = payload.message || '错误';
        infoEl.textContent = msg;
        appendMessage({ type: 'system', username: '系统', content: msg, createdAt: new Date().toISOString() });
        break;
        break;
      }
      case 'users': {
        setOnlineList(payload.users || []);
        break;
      }
      case 'error': {
        infoEl.textContent = payload.message || '错误';
        // 如果是加入房间失败（如用户名重复），仅在聊天框系统消息提醒
        if (payload.message && payload.message.includes('同名用户')) {
          appendMessage({ type: 'system', username: '系统', content: '加入失败：' + payload.message, createdAt: new Date().toISOString() });
        }
        infoEl.textContent = '已断开';
        appendMessage({ type: 'system', username: '系统', content: '连接已断开', createdAt: new Date().toISOString() });
        disconnect();
        break;
      }
    infoEl.textContent = '连接错误';
    appendMessage({ type: 'system', username: '系统', content: '连接错误', createdAt: new Date().toISOString() });
        break;
    }
  });

  socket.addEventListener('close', () => {
    setStatus(false);
    infoEl.textContent = '已断开';
  });

  socket.addEventListener('error', () => {
    infoEl.textContent = '连接错误';
  });
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const content = messageInput.value.trim();
  if (!content) return;
  // 禁用发送按钮1秒
  const sendBtn = chatForm.querySelector('button[type="submit"]');
  sendBtn.disabled = true;
  socket.send(JSON.stringify({ type: 'chat', content }));
  messageInput.value = '';
  setTimeout(() => {
    sendBtn.disabled = false;
  }, 1000);
});

// 用户名和房间缓存：优先用 localStorage
const savedName = localStorage.getItem('chat-username');
const savedChannel = localStorage.getItem('chat-channel');
if (savedName) {
  usernameInput.value = savedName;
} else {
  usernameInput.value = `用户${Math.floor(Math.random() * 900 + 100)}`;
}
if (savedChannel && Array.from(channelSelect.options).some(opt => opt.value === savedChannel)) {
  channelSelect.value = savedChannel;
}
messageInput.disabled = true;

// 监听用户名输入变化，实时保存
usernameInput.addEventListener('input', () => {
  localStorage.setItem('chat-username', usernameInput.value.trim());
});
// 监听频道选择变化，实时保存
channelSelect.addEventListener('change', () => {
  localStorage.setItem('chat-channel', channelSelect.value);
});

// 表情相关
const emojiBtn = document.getElementById('emoji-btn');
const emojiPanel = document.getElementById('emoji-panel');
const micBtn = document.getElementById('mic-btn');
const emojiList = [
  '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗','😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇','🥳','🥺','🤠','🤡','🤥','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','👻','👽','🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾'
];

if (emojiBtn && emojiPanel) {
  emojiBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (emojiPanel.style.display === 'block') {
      emojiPanel.style.display = 'none';
      return;
    }
    // 生成表情
    emojiPanel.innerHTML = '';
    emojiList.forEach(emoji => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.style.fontSize = '22px';
      btn.style.margin = '2px';
      btn.style.background = 'none';
      btn.style.border = 'none';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', () => {
        // 插入表情到输入框
        const start = messageInput.selectionStart;
        const end = messageInput.selectionEnd;
        const value = messageInput.value;
        messageInput.value = value.slice(0, start) + emoji + value.slice(end);
        messageInput.focus();
        messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
        emojiPanel.style.display = 'none';
      });
      emojiPanel.appendChild(btn);
    });
    // 定位面板
    const rect = emojiBtn.getBoundingClientRect();
    emojiPanel.style.left = rect.left + 'px';
    emojiPanel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    emojiPanel.style.display = 'block';
  });
  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (emojiPanel.style.display === 'block' && !emojiPanel.contains(e.target) && e.target !== emojiBtn) {
      emojiPanel.style.display = 'none';
    }
  });
}