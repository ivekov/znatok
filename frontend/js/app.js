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

    switchSection(sectionName) {
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
            
            // ФИКС: Показываем только реальные источники из ответа API
            if (data.sources && data.sources.length > 0) {
                const sourcesHtml = data.sources.map(src =>
                    `<span class="source-chip">${this.escapeHtml(src.source)}</span>`
                ).join('');
                answerHtml += `<div class="message-sources mt-2">Источники: ${sourcesHtml}</div>`;
            }
            
            this.addMessage('assistant', answerHtml);
            
        } catch (error) {
            this.removeTypingIndicator();
            this.addMessage('system', `❌ ${error.message}`);
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

    formatMessageTime(timestamp) {
        const messageDate = new Date(timestamp);
        const now = new Date();
        
        // Разница в миллисекундах
        const diffMs = now - messageDate;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / (3600000 * 24));
        
        // Сегодня - показываем время
        if (messageDate.toDateString() === now.toDateString()) {
            if (diffMins < 1) {
                return 'только что';
            } else if (diffMins < 60) {
                return `${diffMins} мин. назад`;
            } else {
                return messageDate.toLocaleTimeString('ru-RU', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
            }
        }
        // Вчера
        else if (diffDays === 1) {
            return `вчера в ${messageDate.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })}`;
        }
        // На этой неделе
        else if (diffDays < 7) {
            const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
            return `${days[messageDate.getDay()]} в ${messageDate.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })}`;
        }
        // Более недели назад
        else {
            return messageDate.toLocaleDateString('ru-RU', { 
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }

    formatMessageContent(content) {
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
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
    }

    handleFileDrop(files) {
        if (files.length === 0) return;
        const dataTransfer = new DataTransfer();
        for (let file of files) {
            if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'].includes(file.type)) {
                this.showNotification('Поддерживаются только PDF, DOCX, TXT', 'error');
                return;
            }
            dataTransfer.items.add(file);
        }
        document.getElementById('fileInput').files = dataTransfer.files;
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
        formData.append('department', 'all'); // без фильтрации

        try {
            this.showNotification('Загрузка...', 'info');
            const response = await fetch('/api/upload', { method: 'POST', body: formData });
            if (response.ok) {
                this.showNotification('✅ Документы загружены!', 'success');
                this.hideModal('uploadModal');
                fileInput.value = '';
                if (this.currentSection === 'documents') {
                    this.loadDocuments(); // обновить список
                }
            } else {
                const error = await response.text();
                this.showNotification(`❌ ${error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`❌ Ошибка сети`, 'error');
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

            // ФИКС: Отображаем реальные загруженные документы
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

            // Обработчик удаления
            container.querySelectorAll('.action-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const filename = btn.dataset.filename;
                    if (!filename || !confirm(`Удалить документ "${filename}"?`)) return;
                    
                    try {
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

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "<")
            .replace(/>/g, ">")
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

// Динамические стили (оставляем как есть)
const dynamicStyles = `
.message {
    margin-bottom: 1.5rem;
    animation: messageSlide 0.3s ease-out;
}

@keyframes messageSlide {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.user-message {
    display: flex;
    justify-content: flex-end;
}

.assistant-message {
    display: flex;
    justify-content: flex-start;
}

.message-bubble {
    max-width: 70%;
    padding: 1rem 1.25rem;
    border-radius: 18px;
    position: relative;
}

.message-bubble.user {
    background: var(--accent-gradient);
    color: white;
    border-bottom-right-radius: 4px;
}

.message-bubble.assistant {
    background: var(--bg-glass);
    border: 1px solid var(--border-light);
    color: var(--text-primary);
    border-bottom-left-radius: 4px;
}

.message-content {
    line-height: 1.5;
}

.message-content strong {
    font-weight: 600;
}

.message-content em {
    font-style: italic;
}

.message-content code {
    background: rgba(255, 255, 255, 0.1);
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-family: 'Monaco', 'Consolas', monospace;
    font-size: 0.875em;
}

.message-time {
    font-size: 0.75rem;
    opacity: 0.7;
    margin-top: 0.5rem;
}

.typing-indicator {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-secondary);
}

.typing-dots {
    display: flex;
    gap: 0.25rem;
}

.dot {
    width: 6px;
    height: 6px;
    background: var(--text-secondary);
    border-radius: 50%;
    animation: typing 1.4s infinite ease-in-out;
}

.dot:nth-child(1) { animation-delay: -0.32s; }
.dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes typing {
    0%, 80%, 100% { 
        transform: scale(0.8);
        opacity: 0.5;
    }
    40% { 
        transform: scale(1);
        opacity: 1;
    }
}

.notification {
    position: fixed;
    top: 100px;
    right: 2rem;
    background: var(--bg-glass);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border-light);
    border-radius: 12px;
    padding: 1rem 1.5rem;
    transform: translateX(400px);
    transition: transform 0.3s ease;
    z-index: 1000;
    max-width: 300px;
}

.notification.show {
    transform: translateX(0);
}

.notification-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-primary);
}

.notification.success {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.1);
}

.notification.error {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
}

.notification.warning {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
}
.message-sources {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
}
.source-chip {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 12px;
    padding: 0.25rem 0.75rem;
    font-size: 0.85em;
}
[data-theme="light"] .source-chip {
    background: #e0e0e0;
    border-color: #ccc;
    color: #333;
}
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = dynamicStyles;
document.head.appendChild(styleSheet);

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    window.znatokApp = new ZnatokApp();
});