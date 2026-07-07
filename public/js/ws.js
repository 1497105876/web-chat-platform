// ws.js - WebSocket 连接管理
(function() {
  let socket = null;
  let reconnectTimer = null;
  const listeners = {};

  window.ChatWS = {
    connect() {
      const token = ChatAuth.getToken();
      if (!token) return;
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/ws?token=${token}`);

      socket.addEventListener('open', () => {
        this.emit('open');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      });

      socket.addEventListener('message', (event) => {
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }
        this.emit(payload.type, payload);
      });

      socket.addEventListener('close', (event) => {
        this.emit('close', { code: event.code });
        if (event.code === 4001 || event.code === 4002 || event.code === 4003) return;
        reconnectTimer = setTimeout(() => this.connect(), 3000);
      });

      socket.addEventListener('error', () => {
        this.emit('error');
      });
    },

    send(data) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    },

    close() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (socket) { socket.close(); socket = null; }
    },

    on(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },

    off(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(f => f !== fn);
    },

    emit(event, data) {
      (listeners[event] || []).forEach(fn => fn(data));
    },

    get connected() {
      return socket && socket.readyState === WebSocket.OPEN;
    }
  };
})();
