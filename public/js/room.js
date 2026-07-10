// 文件说明：room.js - 房间（频道）切换、列表渲染与私聊管理模块
// 管理公共频道的列表展示、切换逻辑，以及私聊会话的创建和切换
(function() {
  // 预定义的公共频道列表
  const DEFAULT_ROOMS = ['room1', 'room2', 'room3'];
  // 频道 ID 到中文名称的映射
  const ROOM_NAMES = { room1: '大厅', room2: '技术交流', room3: '休闲水区' };

  // 当前所在的频道（公共频道或私聊频道）
  let currentChannel = null;
  // 已加载的公共房间列表
  let roomList = [];
  // 私聊会话列表
  let dmList = [];

  // 暴露到全局的房间管理模块
  window.ChatRoom = {
    // 只读属性：获取当前所在频道
    get current() { return currentChannel; },

    // 初始化：加载房间列表、注册事件监听、初始化私聊模态框
    init() {
      this.loadRooms();
      // 收到历史消息时更新当前频道的激活状态
      ChatWS.on('history', () => this.updateActive());
      // 收到私聊开启事件时，将对方加入私聊列表并自动切换到该私聊频道
      ChatWS.on('dm:open', (data) => this.onDmOpen(data));
      // 连接建立后收到已有私聊房间列表，批量渲染到侧边栏（不自动切换）
      ChatWS.on('dm:list', (data) => this.onDmList(data));
      this.initDmModal();
    },

    // 渲染公共频道列表到左侧边栏
    loadRooms() {
      const listEl = document.getElementById('room-list');
      if (!listEl) return;
      listEl.innerHTML = '';
      DEFAULT_ROOMS.forEach(name => {
        const li = document.createElement('li');
        li.className = 'room-item';
        li.dataset.channel = name;
        li.innerHTML = `<span class="room-icon">#</span><span class="room-name">${ROOM_NAMES[name] || name}</span>`;
        // 点击频道项时切换到该频道
        li.addEventListener('click', () => this.joinRoom(name));
        listEl.appendChild(li);
      });
    },

    // 切换频道：先离开当前频道，再加入新频道
    joinRoom(channel) {
      // 已在目标频道则不重复切换
      if (currentChannel === channel) return;
      // 离开当前频道
      if (currentChannel) {
        ChatWS.send({ type: 'leave' });
      }
      currentChannel = channel;
      // 发送加入新频道的消息
      ChatWS.send({ type: 'join', channel });
      // 更新顶部显示的频道名称（私聊显示对方昵称，公共频道显示中文名）
      const dm = dmList.find(d => d.channel === channel);
      const displayName = dm ? (dm.targetUser.nickname || dm.targetUser.username) : (ROOM_NAMES[channel] || channel);
      document.getElementById('channel-name').textContent = displayName;
      this.updateActive();
    },

    // 更新频道列表的激活状态高亮
    updateActive() {
      document.querySelectorAll('.room-item').forEach(el => {
        el.classList.toggle('active', el.dataset.channel === currentChannel);
      });
      document.querySelectorAll('.dm-item').forEach(el => {
        el.classList.toggle('active', el.dataset.channel === currentChannel);
      });
    },

    // 收到私聊开启事件的处理：将私聊会话加入列表
    // 自己发起的会自动切换过去，对方收到只加入列表不切换（避免打断对方当前聊天）
    onDmOpen(data) {
      const { channel, targetUser, initiator } = data;
      // 避免重复添加相同的私聊频道
      if (!dmList.find(d => d.channel === channel)) {
        dmList.push({ channel, targetUser });
        this.renderDmList();
      }
      // 只有自己发起的私聊才自动切换过去，对方只加入列表
      if (initiator) {
        this.joinRoom(channel);
      }
    },

    // 收到已有私聊列表：批量加载到侧边栏，不自动切换（仅展示历史私聊）
    onDmList(data) {
      (data.rooms || []).forEach(r => {
        if (!dmList.find(d => d.channel === r.channel)) {
          dmList.push({
            channel: r.channel,
            targetUser: { id: r.targetId, username: r.username, nickname: r.nickname }
          });
        }
      });
      this.renderDmList();
    },

    // 渲染私聊列表到左侧边栏
    renderDmList() {
      const listEl = document.getElementById('dm-list');
      if (!listEl) return;
      listEl.innerHTML = '';
      dmList.forEach(dm => {
        const li = document.createElement('li');
        li.className = 'dm-item room-item';
        li.dataset.channel = dm.channel;
        li.innerHTML = `<span class="room-icon dm-icon">@</span><span class="room-name">${dm.targetUser.nickname || dm.targetUser.username}</span>`;
        // 点击私聊项时切换到该私聊频道
        li.addEventListener('click', () => this.joinRoom(dm.channel));
        listEl.appendChild(li);
      });
    },

    // 初始化"发起私聊"模态框的交互逻辑
    initDmModal() {
      const modal = document.getElementById('dm-modal');
      const newDmBtn = document.getElementById('new-dm-btn');
      const closeBtn = document.getElementById('dm-modal-close');
      const searchInput = document.getElementById('dm-search');
      const userList = document.getElementById('dm-user-list');

      // 相关元素不存在时跳过初始化
      if (!modal || !newDmBtn) return;

      // 点击"新私聊"按钮时打开模态框并加载用户列表
      newDmBtn.addEventListener('click', () => {
        modal.style.display = '';
        searchInput.value = '';
        userList.innerHTML = '';
        searchInput.focus();
        this.searchUsers('');
      });

      // 关闭按钮和点击遮罩关闭模态框
      closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });

      // 搜索输入框：使用防抖（300ms）减少请求频率
      let searchTimer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => this.searchUsers(searchInput.value.trim()), 300);
      });
    },

    // 调用后端接口搜索用户列表，用于私聊选择
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
          // 显示昵称和用户名，使用 esc 函数防止 XSS
          li.innerHTML = `<span>${esc(u.nickname || u.username)}</span><span class="muted" style="margin-left:auto;font-size:12px">@${esc(u.username)}</span>`;
          // 点击用户项时发送私聊请求并关闭模态框
          li.addEventListener('click', () => {
            ChatWS.send({ type: 'dm', targetUserId: u.id });
            document.getElementById('dm-modal').style.display = 'none';
          });
          userList.appendChild(li);
        });
        // 未找到用户时显示提示
        if (userList.children.length === 0) {
          userList.innerHTML = '<li class="muted" style="padding:12px;text-align:center">未找到用户</li>';
        }
      } catch (err) {
        console.error('搜索用户失败:', err);
      }
    }
  };

  // HTML 转义工具函数：防止 XSS 攻击
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
})();
