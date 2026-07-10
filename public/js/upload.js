// 文件说明：upload.js - 图片上传功能模块
// 负责图片文件的选择、校验、上传到服务器，并通过 WebSocket 发送图片消息
(function() {
  // 获取上传按钮和隐藏的文件输入框
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');

  // 如果页面上不存在上传相关元素，则跳过初始化
  if (!uploadBtn || !fileInput) return;

  // 点击上传按钮时触发隐藏的文件选择框
  uploadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  // 文件选择后的处理流程
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // 重置 fileInput，确保选择同一文件时也能触发 change 事件
    fileInput.value = '';

    // 前端校验：图片大小不能超过 5MB
    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过 5MB');
      return;
    }
    // 前端校验：只允许图片类型文件
    if (!file.type.startsWith('image/')) {
      alert('只能上传图片文件');
      return;
    }

    // 上传过程中禁用按钮并显示加载状态
    uploadBtn.disabled = true;
    uploadBtn.textContent = '⏳';

    try {
      // 构建 FormData 表单数据用于文件上传
      const formData = new FormData();
      formData.append('file', file);
      const token = ChatAuth.getToken();
      // 上传接口不需要设置 Content-Type，浏览器会自动添加 multipart/form-data 边界
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');

      // 上传成功后，通过 WebSocket 发送图片消息到当前频道
      if (ChatWS.connected) {
        ChatWS.send({
          type: 'chat',
          content: { url: data.url },
          contentType: 'image'
        });
      }
    } catch (err) {
      // 上传失败时弹出错误提示
      alert('图片上传失败: ' + err.message);
    } finally {
      // 无论成功或失败，恢复上传按钮状态
      uploadBtn.disabled = false;
      uploadBtn.textContent = '📷';
    }
  });
})();
