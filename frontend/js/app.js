// Znatok AI Assistant - Modern Frontend Application
class ZnatokApp {
    constructor() {
        this.currentSection = 'chat';
        this.theme = localStorage.getItem('znatok-theme') || 'dark';
        this.chatHistory = JSON.parse(localStorage.getItem('znatok-chat-history')) || [];
        this.init();
    }

    init() {
        this.setTheme(this.theme);
        this.bindEvents();
        this.bindSettingsEvents();
        this.loadChatHistory();
        this.autoResizeTextarea();
        
        // Загружаем документы при старте, если открыта вкладка
        if (this.currentSection === 'documents') {
            this.loadDocuments();
        }
    }

    setTheme(theme) {
        this.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('znatok-theme', theme);
        
        const themeIcon = document.querySelector('#themeToggle i');
        themeIcon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon';
    }

    bindEvents() {
        // Theme toggle
        document.getElementById('themeToggle').addEventListener('click', () => {
            this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
        });

        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchSection(e.currentTarget.dataset.section);
            });
        });

        // Chat functionality
        document.getElementById('send-message').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('message-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        document.getElementById('clear-chat').addEventListener('click', () => {
            this.clearChat();
        });

        document.getElementById('export-chat').addEventListener('click', () => {
            this.exportChat();
        });

        // Document upload
        document.getElementById('upload-documents').addEventListener('click', () => {
            this.showModal('uploadModal');
        });

        document.getElementById('browseFiles').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('confirmUpload').addEventListener('click', () => {
            this.uploadFiles();
        });
        
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files);
        });

        document.getElementById('uploadZone').addEventListener('dragover', (e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = 'var(--accent-primary)';
            e.currentTarget.style.background = 'var(--bg-glass-hover)';
        });

        document.getElementById('uploadZone').addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = 'var(--border-light)';
            e.currentTarget.style.background = 'transparent';
        });

        document.getElementById('uploadZone').addEventListener('drop', (e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = 'var(--border-light)';
            e.currentTarget.style.background = 'transparent';
            this.handleFileDrop(e.dataTransfer.files);
        });

        // Modal close events
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.hideModal(e.currentTarget.dataset.modal);
            });
        });

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) {
                    this.hideModal(e.currentTarget.id);
                }
            });
        });

        // Suggestion chips
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('suggestion-chip')) {
                document.getElementById('message-input').value = e.target.textContent;
                this.sendMessage();
            }
        });
    }

    bindSettingsEvents() {
        // Переключение провайдеров
        document.getElementById('provider-select').addEventListener('change', (e) => {
            this.showProviderSettings(e.target.value);
        });

        // Обновление значения температуры
        document.getElementById('temperature').addEventListener('input', (e) => {
            document.getElementById('temperature-value').textContent = e.target.value;
        });

        // Сохранение настроек
        document.getElementById('save-settings').addEventListener('click', () => {
            this.saveSettings();
        });

        // Тест подключения
        document.getElementById('test-connection').addEventListener('click', () => {
            this.testConnection();
        });
    }

    async switchSection(sectionName) {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');

        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(`${sectionName}-section`).classList.add('active');

        this.currentSection = sectionName;

        // Загружаем документы при переходе на вкладку
        if (sectionName === 'documents') {
            this.loadDocuments();
        }
        
        // Загружаем настройки при переходе в соответствующий раздел
        if (sectionName === 'settings') {
            await this.loadSettings();
        }
    }

    async sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        if (!message) return;

        this.addMessage('user', message);
        input.value = '';
        this.autoResizeTextarea();
        this.showTypingIndicator();

        try {
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: message, user_department: 'all' })
            });

            this.removeTypingIndicator();
            if (!response.ok) throw new Error(`Ошибка: ${response.status}`);

            const data = await response.json();
            let answerHtml = data.answer;
            
            // ФИКС: Уникальные источники
            if (data.sources && data.sources.length > 0) {
                const uniqueSources = [...new Set(data.sources.map(src => src.source))];
                const sourcesHtml = uniqueSources.map(src =>
                    `<span class="source-chip">${this.escapeHtml(src)}</span>`
                ).join('');
                answerHtml += `<div class="message-sources mt-2">Источники: ${sourcesHtml}</div>`;
            }
            
            this.addMessage('assistant', answerHtml);
            
        } catch (error) {
            this.removeTypingIndicator();
            const errorMessage = this.handleApiError(error, 'Не удалось получить ответ');
            this.addMessage('system', errorMessage);
            console.error('Chat error:', error);
        }
    }

    addMessage(role, content) {
        const message = { id: Date.now(), role, content, timestamp: new Date() };
        this.chatHistory.push(message);
        this.renderMessage(message);
        this.saveChatHistory();
        this.scrollToBottom();
    }

    renderMessage(message) {
        const container = document.getElementById('chat-messages');
        if (message.role === 'user') {
            const welcome = container.querySelector('.welcome-message');
            if (welcome) welcome.remove();
        }

        const el = document.createElement('div');
        el.className = `message ${message.role}-message`;
        el.innerHTML = this.getMessageHTML(message);
        container.appendChild(el);
    }

    getMessageHTML(message) {
        const time = this.formatMessageTime(message.timestamp);
        return `
            <div class="message-bubble ${message.role}">
                <div class="message-content">${this.formatMessageContent(message.content)}</div>
                <div class="message-time">${time}</div>
            </div>
        `;
    }

    formatMessageContent(content) {
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    formatMessageTime(timestamp) {
        const messageDate = new Date(timestamp);
        const now = new Date();
        
        // Сегодня
        if (messageDate.toDateString() === now.toDateString()) {
            return messageDate.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        }
        // Вчера
        else if ((now - messageDate) < 48 * 60 * 60 * 1000) {
            return `вчера ${messageDate.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })}`;
        }
        // На этой неделе (до 7 дней)
        else if ((now - messageDate) < 7 * 24 * 60 * 60 * 1000) {
            return messageDate.toLocaleDateString('ru-RU', { 
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        // Более недели назад
        else {
            return messageDate.toLocaleDateString('ru-RU', { 
                day: 'numeric',
                month: 'short'
            });
        }
    }

    showTypingIndicator() {
        const container = document.getElementById('chat-messages');
        const el = document.createElement('div');
        el.className = 'message assistant-message typing';
        el.id = 'typing-indicator';
        el.innerHTML = `
            <div class="message-bubble assistant">
                <div class="typing-indicator">
                    <span>Знаток печатает</span>
                    <div class="typing-dots">
                        <div class="dot"></div>
                        <div class="dot"></div>
                        <div class="dot"></div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(el);
        this.scrollToBottom();
    }

    removeTypingIndicator() {
        const el = document.getElementById('typing-indicator');
        if (el) el.remove();
    }

    clearChat() {
        if (confirm('Очистить историю чата?')) {
            this.chatHistory = [];
            document.getElementById('chat-messages').innerHTML = `
                <div class="welcome-message">
                    <div class="welcome-card">
                        <div class="ai-avatar"><i class="bi bi-cpu"></i></div>
                        <h3>Добро пожаловать в Знаток!</h3>
                        <p>Задайте вопрос о внутренних документах</p>
                        <div class="suggestions">
                            <button class="suggestion-chip">Политика удаленной работы</button>
                            <button class="suggestion-chip">Отпуск и больничные</button>
                            <button class="suggestion-chip">ИТ безопасность</button>
                        </div>
                    </div>
                </div>
            `;
            localStorage.removeItem('znatok-chat-history');
        }
    }

    exportChat() {
        const text = this.chatHistory.map(msg => 
            `${msg.role}: ${msg.content}`
        ).join('\n\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `znatok-chat-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        container.scrollTop = container.scrollHeight;
    }

    saveChatHistory() {
        localStorage.setItem('znatok-chat-history', JSON.stringify(this.chatHistory));
    }

    loadChatHistory() {
        const stored = localStorage.getItem('znatok-chat-history');
        if (stored) {
            try {
                this.chatHistory = JSON.parse(stored);
                // Конвертируем строки времени обратно в Date объекты
                this.chatHistory.forEach(msg => {
                    if (typeof msg.timestamp === 'string') {
                        msg.timestamp = new Date(msg.timestamp);
                    }
                });
            } catch (e) {
                console.error('Failed to load chat history', e);
                this.chatHistory = [];
            }
        }

        if (this.chatHistory.length > 0) {
            const container = document.getElementById('chat-messages');
            container.innerHTML = '';
            this.chatHistory.forEach(msg => this.renderMessage(msg));
            this.scrollToBottom();
        }
    }

    autoResizeTextarea() {
        const textarea = document.getElementById('message-input');
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
        if (modalId === 'uploadModal') {
            this.clearFilePreviews();
        }
    }

    handleFileSelect(files) {
        if (files.length === 0) return;
        
        // Проверяем типы файлов
        const validFiles = Array.from(files).filter(file => 
            ['application/pdf', 
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/msword',
             'text/plain'].includes(file.type) ||
            file.name.toLowerCase().endsWith('.pdf') ||
            file.name.toLowerCase().endsWith('.docx') ||
            file.name.toLowerCase().endsWith('.doc') ||
            file.name.toLowerCase().endsWith('.txt')
        );

        if (validFiles.length === 0) {
            this.showNotification('Поддерживаются только PDF, DOCX, DOC, TXT', 'error');
            return;
        }

        if (validFiles.length !== files.length) {
            this.showNotification('Некоторые файлы не поддерживаются и были пропущены', 'warning');
        }

        this.renderFilePreviews(validFiles);
    }

    handleFileDrop(files) {
        if (files.length === 0) return;
        
        // Создаем DataTransfer для обновления input
        const dataTransfer = new DataTransfer();
        const validFiles = Array.from(files).filter(file => 
            ['application/pdf', 
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/msword',
             'text/plain'].includes(file.type) ||
            file.name.toLowerCase().endsWith('.pdf') ||
            file.name.toLowerCase().endsWith('.docx') ||
            file.name.toLowerCase().endsWith('.doc') ||
            file.name.toLowerCase().endsWith('.txt')
        );

        if (validFiles.length === 0) {
            this.showNotification('Поддерживаются только PDF, DOCX, DOC, TXT', 'error');
            return;
        }

        validFiles.forEach(file => dataTransfer.items.add(file));
        document.getElementById('fileInput').files = dataTransfer.files;
        
        this.renderFilePreviews(validFiles);
    }

    renderFilePreviews(files) {
        const previewContainer = document.getElementById('uploadPreview');
        const filePreviews = document.getElementById('filePreviews');
        const uploadZone = document.getElementById('uploadZone');
        
        // Очищаем предыдущие превью
        filePreviews.innerHTML = '';
        
        // Добавляем новые превью
        files.forEach((file, index) => {
            const fileExtension = this.getFileExtension(file.name);
            const fileSize = this.formatFileSize(file.size);
            const fileType = this.getFileType(fileExtension);
            
            const preview = document.createElement('div');
            preview.className = 'file-preview';
            preview.innerHTML = `
                <div class="file-icon ${fileType}">
                    <i class="bi ${this.getFileIcon(fileExtension)}"></i>
                </div>
                <div class="file-info">
                    <div class="file-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</div>
                    <div class="file-size">${fileSize}</div>
                </div>
                <button class="file-remove" data-index="${index}">
                    <i class="bi bi-x-lg"></i>
                </button>
            `;
            filePreviews.appendChild(preview);
        });
        
        // Показываем контейнер превью и обновляем стиль зоны загрузки
        previewContainer.style.display = 'block';
        uploadZone.classList.add('has-files');
        
        // Добавляем обработчики удаления файлов
        filePreviews.querySelectorAll('.file-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeFilePreview(parseInt(btn.dataset.index));
            });
        });
    }

    removeFilePreview(index) {
        const fileInput = document.getElementById('fileInput');
        const files = Array.from(fileInput.files);
        
        // Удаляем файл из списка
        files.splice(index, 1);
        
        // Обновляем input files
        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        fileInput.files = dataTransfer.files;
        
        // Перерисовываем превью
        if (files.length > 0) {
            this.renderFilePreviews(files);
        } else {
            this.clearFilePreviews();
        }
    }

    clearFilePreviews() {
        const previewContainer = document.getElementById('uploadPreview');
        const filePreviews = document.getElementById('filePreviews');
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        
        filePreviews.innerHTML = '';
        previewContainer.style.display = 'none';
        uploadZone.classList.remove('has-files');
        fileInput.value = '';
    }

    getFileExtension(filename) {
        return filename.toLowerCase().split('.').pop();
    }

    getFileType(extension) {
        const typeMap = {
            'pdf': 'pdf',
            'docx': 'docx',
            'doc': 'doc',
            'txt': 'txt'
        };
        return typeMap[extension] || 'unknown';
    }

    getFileIcon(extension) {
        const iconMap = {
            'pdf': 'bi-file-earmark-pdf',
            'docx': 'bi-file-earmark-word',
            'doc': 'bi-file-earmark-word',
            'txt': 'bi-file-earmark-text'
        };
        return iconMap[extension] || 'bi-file-earmark';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async uploadFiles() {
        const fileInput = document.getElementById('fileInput');
        const files = fileInput.files;
        if (files.length === 0) {
            this.showNotification('Выберите файлы', 'warning');
            return;
        }

        const formData = new FormData();
        for (let file of files) {
            formData.append('files', file);
        }
        formData.append('department', 'all');

        try {
            this.showNotification('Загрузка...', 'info');
            const response = await fetch('/api/upload', { method: 'POST', body: formData });
            
            if (response.ok) {
                this.showNotification('✅ Документы загружены!', 'success');
                this.hideModal('uploadModal');
                this.clearFilePreviews(); // Очищаем превью после успешной загрузки
                if (this.currentSection === 'documents') {
                    this.loadDocuments();
                }
            } else {
                const error = await response.text();
                this.showNotification(`❌ ${error}`, 'error');
            }
        } catch (error) {
            const errorMessage = this.handleApiError(error, 'Ошибка загрузки файлов');
            this.showNotification(errorMessage, 'error');
            console.error('Upload error:', error);
        }
    }

    async loadDocuments() {
        const container = document.getElementById('documents-list-container');
        container.innerHTML = '<p class="text-muted">Загрузка...</p>';

        try {
            const response = await fetch('/api/documents');
            if (!response.ok) throw new Error('Не удалось загрузить');
            const docs = await response.json();

            if (docs.length === 0) {
                container.innerHTML = '<p class="text-muted">Нет загруженных документов.</p>';
                return;
            }

            // ФИКС: Используем filename вместо id
            const html = docs.map(doc => `
                <div class="document-card">
                    <div class="doc-icon pdf">
                        <i class="bi bi-file-earmark"></i>
                    </div>
                    <div class="doc-content">
                        <h4>${this.escapeHtml(doc.filename)}</h4>
                        <p class="doc-meta">Загружен: ${new Date(doc.uploaded_at).toLocaleDateString('ru-RU')}</p>
                    </div>
                    <div class="doc-actions">
                        <button class="action-btn" data-filename="${this.escapeHtml(doc.filename)}" title="Удалить">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');

            container.innerHTML = html;

            // ФИКС: Обработчик удаления с правильным filename
            container.querySelectorAll('.action-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const filename = btn.dataset.filename;
                    if (!filename || !confirm(`Удалить документ "${filename}"?`)) return;
                    
                    try {
                        // ФИКС: Правильное кодирование имени файла в URL
                        const encodedFilename = encodeURIComponent(filename);
                        const res = await fetch(`/api/documents/${encodedFilename}`, { 
                            method: 'DELETE' 
                        });
                        
                        if (res.ok) {
                            this.showNotification('✅ Документ удален', 'success');
                            this.loadDocuments(); // перезагрузить список
                        } else {
                            const errorText = await res.text();
                            this.showNotification(`❌ Ошибка удаления: ${errorText}`, 'error');
                        }
                    } catch (e) {
                        this.showNotification('❌ Сетевая ошибка при удалении', 'error');
                        console.error('Delete error:', e);
                    }
                });
            });

        } catch (error) {
            container.innerHTML = `<p class="text-danger">Ошибка: ${error.message}</p>`;
        }
    }

    async loadSettings() {
        try {
            const response = await fetch('/api/settings');
            if (!response.ok) throw new Error('Не удалось загрузить настройки');
            const settings = await response.json();
            this.renderSettings(settings);
        } catch (error) {
            this.showNotification('Ошибка загрузки настроек', 'error');
        }
    }

    renderSettings(settings) {
        // Установка выбранного провайдера
        const providerSelect = document.getElementById('provider-select');
        providerSelect.value = settings.current_provider;

        // Показ соответствующих настроек
        this.showProviderSettings(settings.current_provider);

        // Заполнение настроек провайдеров
        if (settings.providers) {
            Object.entries(settings.providers).forEach(([provider, config]) => {
                if (provider === 'gigachat') {
                    document.getElementById('gigachat-api-key').value = config.api_key || '';
                    document.getElementById('gigachat-model').value = config.model || 'GigaChat';
                } else if (provider === 'yandex_gpt') {
                    document.getElementById('yandex-api-key').value = config.api_key || '';
                    document.getElementById('yandex-model').value = config.model || 'yandexgpt/latest';
                } else if (provider === 'mistral') {
                    document.getElementById('mistral-api-key').value = config.api_key || '';
                    document.getElementById('mistral-model').value = config.model || 'mistral-medium';
                }

                // Общие настройки
                document.getElementById('temperature').value = config.temperature || 0.1;
                document.getElementById('temperature-value').textContent = config.temperature || 0.1;
                document.getElementById('max-tokens').value = config.max_tokens || 512;
            });
        }
    }

    showProviderSettings(provider) {
        // Скрываем все настройки провайдеров
        document.querySelectorAll('.provider-settings').forEach(el => {
            el.classList.remove('active');
        });
        
        // Показываем выбранный провайдер
        const providerEl = document.getElementById(`${provider}-settings`);
        if (providerEl) {
            providerEl.classList.add('active');
        }
    }

    async saveSettings() {
        const provider = document.getElementById('provider-select').value;
        
        const settings = {
            current_provider: provider,
            providers: {
                gigachat: {
                    provider: 'gigachat',
                    api_key: document.getElementById('gigachat-api-key').value,
                    model: document.getElementById('gigachat-model').value,
                    temperature: parseFloat(document.getElementById('temperature').value),
                    max_tokens: parseInt(document.getElementById('max-tokens').value)
                },
                yandex_gpt: {
                    provider: 'yandex_gpt',
                    api_key: document.getElementById('yandex-api-key').value,
                    model: document.getElementById('yandex-model').value,
                    temperature: parseFloat(document.getElementById('temperature').value),
                    max_tokens: parseInt(document.getElementById('max-tokens').value)
                },
                mistral: {
                    provider: 'mistral',
                    api_key: document.getElementById('mistral-api-key').value,
                    model: document.getElementById('mistral-model').value,
                    temperature: parseFloat(document.getElementById('temperature').value),
                    max_tokens: parseInt(document.getElementById('max-tokens').value)
                }
            }
        };

        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });

            if (response.ok) {
                this.showNotification('Настройки сохранены', 'success');
            } else {
                throw new Error('Ошибка сохранения');
            }
        } catch (error) {
            this.showNotification('Ошибка сохранения настроек', 'error');
        }
    }

    async testConnection() {
        const provider = document.getElementById('provider-select').value;
        
        try {
            this.showNotification('Проверка подключения...', 'info');
            
            // Сохраняем настройки временно
            await this.saveSettings();
            
            // Тестируем с простым запросом
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    question: 'Привет! Ответь коротко: соединение установлено?',
                    user_department: 'all' 
                })
            });

            if (response.ok) {
                this.showNotification('✅ Подключение успешно!', 'success');
            } else {
                throw new Error('Ошибка тестирования');
            }
        } catch (error) {
            this.showNotification('❌ Ошибка подключения', 'error');
        }
    }

    handleApiError(error, defaultMessage = 'Произошла ошибка') {
        if (error.message.includes('Failed to fetch')) {
            return '❌ Ошибка соединения с сервером';
        }
        if (error.message.includes('502')) {
            return '❌ Сервис временно недоступен';
        }
        return `❌ ${error.message || defaultMessage}`;
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="bi bi-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
            </div>
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 100);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    getNotificationIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-triangle',
            warning: 'exclamation-circle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    window.znatokApp = new ZnatokApp();
});