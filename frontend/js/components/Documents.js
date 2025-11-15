// frontend/js/components/Documents.js
import { ApiClient } from '../core/ApiClient.js';
import { Notification } from '../core/Notification.js';
import { Utils } from '../core/Utils.js';

export class Documents {
    constructor() {
        this.bindEvents();
        this.load();
    }

    bindEvents() {
        document.getElementById('upload-documents')?.addEventListener('click', () => {
            document.getElementById('uploadModal').classList.add('active');
        });

        ['browseFiles', 'fileInput', 'uploadZone', 'confirmUpload', 'modal-close', 'modal-overlay']
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('click', (e) => this.handleUploadUI(e));
            });

        document.getElementById('uploadZone')?.addEventListener('dragover', this.handleDragOver);
        document.getElementById('uploadZone')?.addEventListener('dragleave', this.handleDragLeave);
        document.getElementById('uploadZone')?.addEventListener('drop', (e) => {
            e.preventDefault();
            this.handleFileDrop(e.dataTransfer.files);
        });
    }

    handleUploadUI(e) {
        if (e.target.id === 'browseFiles') {
            document.getElementById('fileInput').click();
        } else if (e.target.id === 'confirmUpload') {
            this.upload();
        } else if (e.target.classList.contains('modal-close') || e.target.classList.contains('modal-overlay')) {
            this.hideModal();
        }
    }

    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.style.borderColor = 'var(--accent-primary)';
        e.currentTarget.style.background = 'var(--bg-glass-hover)';
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.currentTarget.style.borderColor = 'var(--border-light)';
        e.currentTarget.style.background = 'transparent';
    }

    async upload() {
        const files = document.getElementById('fileInput').files;
        if (files.length === 0) {
            Notification.show('Выберите файлы', 'warning');
            return;
        }

        const valid = Array.from(files).filter(f => Utils.isValidFile(f.name));
        if (valid.length === 0) {
            Notification.show('Поддерживаются только PDF, DOCX, DOC, TXT', 'error');
            return;
        }

        const formData = new FormData();
        valid.forEach(f => formData.append('files', f));
        formData.append('department', 'all');

        try {
            Notification.show('Загрузка...', 'info');
            await fetch('/api/upload', { method: 'POST', body: formData });
            Notification.show('✅ Документы загружены!', 'success');
            this.hideModal();
            this.load();
        } catch (err) {
            Notification.show(`❌ ${err.message}`, 'error');
        }
    }

    hideModal() {
        document.getElementById('uploadModal').classList.remove('active');
        document.getElementById('uploadPreview').style.display = 'none';
        document.getElementById('filePreviews').innerHTML = '';
        document.getElementById('fileInput').value = '';
        document.getElementById('uploadZone').classList.remove('has-files');
    }

    handleFileDrop(files) {
        const valid = Array.from(files).filter(f => Utils.isValidFile(f.name));
        if (valid.length === 0) {
            Notification.show('Поддерживаются только PDF, DOCX, DOC, TXT', 'error');
            return;
        }
        const dt = new DataTransfer();
        valid.forEach(f => dt.items.add(f));
        document.getElementById('fileInput').files = dt.files;
        this.renderPreviews(valid);
    }

    renderPreviews(files) {
        const container = document.getElementById('filePreviews');
        container.innerHTML = '';
        files.forEach((file, i) => {
            const ext = Utils.getFileExtension(file.name);
            const el = document.createElement('div');
            el.className = 'file-preview';
            el.innerHTML = `
                <div class="file-icon ${Utils.getFileType(ext)}">
                    <i class="bi ${Utils.getFileIcon(ext)}"></i>
                </div>
                <div class="file-info">
                    <div class="file-name" title="${Utils.escapeHtml(file.name)}">${Utils.escapeHtml(file.name)}</div>
                    <div class="file-size">${Utils.formatFileSize(file.size)}</div>
                </div>
                <button class="file-remove" data-index="${i}"><i class="bi bi-x-lg"></i></button>
            `;
            container.appendChild(el);
        });
        document.getElementById('uploadPreview').style.display = 'block';
        document.getElementById('uploadZone').classList.add('has-files');
    }

    async load() {
        const container = document.getElementById('documents-list-container');
        container.innerHTML = '<p class="text-muted">Загрузка...</p>';
        try {
            const docs = await ApiClient.get('/api/documents');
            if (docs.length === 0) {
                container.innerHTML = '<p class="text-muted">Нет загруженных документов.</p>';
                return;
            }
            container.innerHTML = docs.map(doc => `
                <div class="card">
                    <div class="doc-icon pdf"><i class="bi bi-file-earmark"></i></div>
                    <div class="doc-content">
                        <h4>${Utils.escapeHtml(doc.filename)}</h4>
                        <p class="doc-meta">Загружен: ${new Date(doc.uploaded_at).toLocaleDateString('ru-RU')}</p>
                    </div>
                    <div class="doc-actions">
                        <button class="action-btn" data-filename="${Utils.escapeHtml(doc.filename)}" title="Удалить">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.action-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const name = btn.dataset.filename;
                    if (!name || !confirm(`Удалить документ "${name}"?`)) return;
                    try {
                        await ApiClient.delete(`/api/documents/${encodeURIComponent(name)}`);
                        Notification.show('✅ Документ удален', 'success');
                        this.load();
                    } catch (e) {
                        Notification.show('❌ Ошибка удаления', 'error');
                    }
                });
            });
        } catch (e) {
            container.innerHTML = `<p class="text-danger">Ошибка: ${e.message}</p>`;
        }
    }
}