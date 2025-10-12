// documents.js — управление документами
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  const deptSelect = document.getElementById('department-select');
  const uploadBtn = document.getElementById('upload-btn');
  const uploadStatus = document.getElementById('upload-status');
  const docsList = document.getElementById('documents-list');

  // Загрузка списка документов при открытии вкладки
  const docsTab = document.querySelector('[data-bs-target="#docs-tab"]');
  docsTab.addEventListener('click', loadDocuments);

  async function loadDocuments() {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) throw new Error('Не удалось загрузить список');
      const docs = await res.json();
      renderDocuments(docs);
    } catch (err) {
      docsList.innerHTML = `<div class="alert alert-danger">Ошибка: ${err.message}</div>`;
    }
  }

  function renderDocuments(docs) {
    if (!docs.length) {
      docsList.innerHTML = '<p class="text-muted">Нет загруженных документов.</p>';
      return;
    }

    const html = docs.map(doc => `
      <div class="border rounded p-3 mb-2">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <strong>${escapeHtml(doc.filename)}</strong>
            <div class="small text-muted">Отдел: ${doc.department || '—'}</div>
            <div class="small text-muted">Загружен: ${new Date(doc.uploaded_at).toLocaleString()}</div>
          </div>
          <button class="btn btn-sm btn-outline-danger" data-id="${doc.id}">Удалить</button>
        </div>
      </div>
    `).join('');

    docsList.innerHTML = html;

    // Обработчик удаления
    docsList.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить документ?')) return;
        const id = btn.dataset.id;
        try {
          const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
          if (res.ok) {
            loadDocuments(); // обновить список
          } else {
            alert('Ошибка удаления');
          }
        } catch (err) {
          alert('Сетевая ошибка');
        }
      });
    });
  }

  // Загрузка файла
  uploadBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    const department = deptSelect.value;

    if (!file) {
      uploadStatus.innerHTML = '<div class="text-warning">Выберите файл</div>';
      return;
    }

    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
      uploadStatus.innerHTML = '<div class="text-danger">Поддерживаются только PDF, DOCX, TXT</div>';
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('department', department);

    uploadStatus.innerHTML = '<div class="text-info">Загрузка и индексация...</div>';
    uploadBtn.disabled = true;

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        uploadStatus.innerHTML = '<div class="text-success">✅ Документ успешно проиндексирован!</div>';
        fileInput.value = '';
        loadDocuments();
      } else {
        const err = await res.text();
        uploadStatus.innerHTML = `<div class="text-danger">❌ Ошибка: ${err}</div>`;
      }
    } catch (err) {
      uploadStatus.innerHTML = `<div class="text-danger">❌ Сетевая ошибка: ${err.message}</div>`;
    } finally {
      uploadBtn.disabled = false;
    }
  });

  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});