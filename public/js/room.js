// room.js - 房间切换/列表/私聊
(function() {
  const DEFAULT_ROOMS = ['room1', 'room2', 'room3'];
  const ROOM_NAMES = { room1: '大厅', room2: '技术交流', room3: '休闲水区' };

  let currentChannel = null;
  let roomList = [];
  let dmList = [];

  window.ChatRoom = {
    get current() { return currentChannel; },

    init() {
      this.loadRooms();
      ChatWS.on('history', () => this.updateActive());
      ChatWS.on('dm:open', (data) => this.onDmOpen(data));
      this.initDmModal();
    },

    loadRooms() {
      const listEl = document.getElementById('room-list');
      if (!listEl) return;
      listEl.innerHTML = '';
      DEFAULT_ROOMS.forEach(name => {
        const li = document.createElement('li');
        li.className = 'room-item';
        li.dataset.channel = name;
        li.innerHTML = `<span class="room-icon">#</span><span class="room-name">${ROOM_NAMES[name] || name}</span>`;
        li.addEventListener('click', () => this.joinRoom(name));
        listEl.appendChild(li);
      });
    },

    joinRoom(channel) {
      if (currentChannel === channel) return;
      if (currentChannel) {
        ChatWS.send({ type: 'leave' });
      }
      currentChannel = channel;
      ChatWS.send({ type: 'join', channel });
      const dm = dmList.find(d => d.channel === channel);
      const displayName = dm ? (dm.targetUser.nickname || dm.targetUser.username) : (ROOM_NAMES[channel] || channel);
      document.getElementById('channel-name').textContent = displayName;
      this.updateActive();
    },

    updateActive() {
      document.querySelectorAll('.room-item').forEach(el => {
        el.classList.toggle('active', el.dataset.channel === currentChannel);
      });
      document.querySelectorAll('.dm-item').forEach(el => {
        el.classList.toggle('active', el.dataset.channel === currentChannel);
      });
    },

    onDmOpen(data) {
      const { channel, targetUser } = data;
      if (!dmList.find(d => d.channel === channel)) {
        dmList.push({ channel, targetUser });
        this.renderDmList();
      }
      this.joinRoom(channel);
    },

    renderDmList() {
      const listEl = document.getElementById('dm-list');
      if (!listEl) return;
      listEl.innerHTML = '';
      dmList.forEach(dm => {
        const li = document.createElement('li');
        li.className = 'dm-item room-item';
        li.dataset.channel = dm.channel;
        li.innerHTML = `<span class="room-icon dm-icon">@</span><span class="room-name">${dm.targetUser.nickname || dm.targetUser.username}</span>`;
        li.addEventListener('click', () => this.joinRoom(dm.channel));
        listEl.appendChild(li);
      });
    },

    initDmModal() {
      const modal = document.getElementById('dm-modal');
      const newDmBtn = document.getElementById('new-dm-btn');
      const closeBtn = document.getElementById('dm-modal-close');
      const searchInput = document.getElementById('dm-search');
      const userList = document.getElementById('dm-user-list');

      if (!modal || !newDmBtn) return;

      newDmBtn.addEventListener('click', () => {
        modal.style.display = '';
        searchInput.value = '';
        userList.innerHTML = '';
        searchInput.focus();
        this.searchUsers('');
      });

      closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });

      let searchTimer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => this.searchUsers(searchInput.value.trim()), 300);
      });
    },

    async searchUsers(query) {
      const userList = document.getElementById('dm-user-list');
      if (!userList) return;
      try {
        const params = new URLSearchParams({ limit: 20 });
        if (query) params.set('search', query);
        const data = await ChatAuth.apiFetch(`/api/auth/users?${params}`);
        userList.innerHTML = '';
        (data.users || []).forEach(u => {
          const li = document.createElement('li');
          li.innerHTML = `<span>${esc(u.nickname || u.username)}</span><span class="muted" style="margin-left:auto;font-size:12px">@${esc(u.username)}</span>`;
          li.addEventListener('click', () => {
            ChatWS.send({ type: 'dm', targetUserId: u.id });
            document.getElementById('dm-modal').style.display = 'none';
          });
          userList.appendChild(li);
        });
        if (userList.children.length === 0) {
          userList.innerHTML = '<li class="muted" style="padding:12px;text-align:center">未找到用户</li>';
        }
      } catch (err) {
        console.error('搜索用户失败:', err);
      }
    }
  };

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
})();
