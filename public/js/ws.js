// 文件说明：ws.js - WebSocket 连接管理模块
// 负责与服务器建立 WebSocket 连接、自动重连、消息收发及事件监听
// 采用发布-订阅模式，其他模块通过 on/off 注册事件回调
(function() {
  // 当前 WebSocket 连接实例
  let socket = null;
  // 重连定时器引用，用于在连接恢复后清除
  let reconnectTimer = null;
  // 事件监听器存储，键为事件类型，值为回调函数数组
  const listeners = {};

  // 暴露到全局的 WebSocket 管理模块
  window.ChatWS = {
    // 建立 WebSocket 连接，通过 URL 查询参数传递 token 进行鉴权
    connect() {
      const token = ChatAuth.getToken();
      // 没有 token 则不连接，避免无效连接
      if (!token) return;
      // 根据当前页面协议选择 ws 或 wss 安全连接
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/ws?token=${token}`);

      // 连接成功时触发 open 事件，并清除可能存在的重连定时器
      socket.addEventListener('open', () => {
        this.emit('open');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      });

      // 收到消息时解析 JSON 并按 type 字段分发事件
      socket.addEventListener('message', (event) => {
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }
        this.emit(payload.type, payload);
      });

      // 连接关闭时处理重连逻辑
      socket.addEventListener('close', (event) => {
        this.emit('close', { code: event.code });
        // 4001=认证失败, 4002=被封禁, 4003=被踢出，这些情况不自动重连
        if (event.code === 4001 || event.code === 4002 || event.code === 4003) return;
        // 其他关闭原因 3 秒后自动重连
        reconnectTimer = setTimeout(() => this.connect(), 3000);
      });

      // 连接出错时触发 error 事件
      socket.addEventListener('error', () => {
        this.emit('error');
      });
    },

    // 发送消息：仅当连接处于 OPEN 状态时才发送，避免报错
    send(data) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    },

    // 主动关闭连接并清除重连定时器
    close() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (socket) { socket.close(); socket = null; }
    },

    // 注册事件监听器
    on(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },

    // 移除指定的事件监听器
    off(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(f => f !== fn);
    },

    // 触发指定事件，通知所有注册的监听器
    emit(event, data) {
      (listeners[event] || []).forEach(fn => fn(data));
    },

    // 只读属性：当前是否已连接（WebSocket 处于 OPEN 状态）
    get connected() {
      return socket && socket.readyState === WebSocket.OPEN;
    }
  };
})();
