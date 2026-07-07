// upload.js - 文件上传（预留）
(function() {
  window.ChatUpload = {
    async uploadFile(file) {
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
      return data;
    }
  };
})();
