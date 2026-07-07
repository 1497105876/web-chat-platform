// room.js - 房间切换/列表
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
      document.getElementById('channel-name').textContent = ROOM_NAMES[channel] || channel;
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
    }
  };
})();
