// upload.js - 图片上传
(function() {
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');

  if (!uploadBtn || !fileInput) return;

  uploadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileInput.value = '';

    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过 5MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      alert('只能上传图片文件');
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = '⏳';

    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = ChatAuth.getToken();
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');

      if (ChatWS.connected) {
        ChatWS.send({
          type: 'chat',
          content: { url: data.url },
          contentType: 'image'
        });
      }
    } catch (err) {
      alert('图片上传失败: ' + err.message);
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = '📷';
    }
  });
})();
