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

        // Close modal on overlay click
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
        // Update navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');

        // Update sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(`${sectionName}-section`).classList.add('active');

        this.currentSection = sectionName;
    }

    async sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        
        if (!message) return;

        // Add user message to chat
        this.addMessage('user', message);
        input.value = '';
        this.autoResizeTextarea();

        // Show typing indicator
        this.showTypingIndicator();

        try {
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    question: message,
                    user_department: 'all' // можно заменить на выбор отдела из UI
                })
            });

            // Remove typing indicator
            this.removeTypingIndicator();

            if (!response.ok) {
                throw new Error(`Ошибка сервера: ${response.status}`);
            }

            const data = await response.json();
            let answerHtml = data.answer;

            // Добавляем источники, если есть
            if (data.sources && data.sources.length > 0) {
                const sourcesHtml = data.sources.map(src =>
                    `<span class="source-chip">${this.escapeHtml(src.source)}</span>`
                ).join('');
                answerHtml += `<div class="message-sources mt-2">${sourcesHtml}</div>`;
            }

            this.addMessage('assistant', answerHtml);
            
        } catch (error) {
            this.removeTypingIndicator();
            this.addMessage('system', `❌ Ошибка: ${error.message}. Проверьте подключение к серверу.`);
            console.error('Chat API error:', error);
        }
    }

    addMessage(role, content) {
        const message = {
            id: Date.now(),
            role,
            content,
            timestamp: new Date()
        };
        
        this.chatHistory.push(message);
        this.renderMessage(message);
        this.saveChatHistory();
        this.scrollToBottom();
    }

    renderMessage(message) {
        const messagesContainer = document.getElementById('chat-messages');
        
        // Remove welcome message if it's the first user message
        if (message.role === 'user') {
            const welcomeMessage = messagesContainer.querySelector('.welcome-message');
            if (welcomeMessage) {
                welcomeMessage.remove();
            }
        }

        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.role}-message`;
        messageElement.innerHTML = this.getMessageHTML(message);
        messagesContainer.appendChild(messageElement);
    }

    getMessageHTML(message) {
        const time = message.timestamp.toLocaleTimeString('ru-RU', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        return `
            <div class="message-bubble ${message.role}">
                <div class="message-content">${this.formatMessageContent(message.content)}</div>
                <div class="message-time">${time}</div>
            </div>
        `;
    }

    formatMessageContent(content) {
        // Convert basic markdown to HTML
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    generateAIResponse(question) {
        const responses = {
            'политика удаленной работы': `**Политика удаленной работы** позволяет сотрудникам работать из дома при соблюдении условий:\n\n• Стаж в компании от 6 месяцев\n• Согласование с руководителем\n• Наличие необходимого оборудования\n• Ежедневные стендапы в 10:00\n\nПолный документ доступен в разделе "Документы".`,
            'отпуск и больничные': `**Отпуск и больничные** оформляются согласно трудовому кодексу:\n\n• Ежегодный отпуск - 28 календарных дней\n• Больничные оплачиваются с первого дня\n• Заявление на отпуск за 2 недели\n• Документы для больничного в HR отделе`,
            'ит безопасность': `**Политика информационной безопасности** включает:\n\n• Обязательная двухфакторная аутентификация\n• Регулярная смена паролей (90 дней)\n• Шифрование конфиденциальных данных\n• Запрет личных облачных хранилищ\n\nПодробнее в документе "Инструкция по ИБ".`
        };

        const lowerQuestion = question.toLowerCase();
        for (const [key, response] of Object.entries(responses)) {
            if (lowerQuestion.includes(key)) {
                return response;
            }
        }

        // Default response for unknown questions
        return `На основе внутренних документов, я нашел следующую информацию:\n\n**${question}**\n\nВ нашей компании этот вопрос регулируется корпоративными политиками. Для получения точной информации рекомендую обратиться к соответствующим документам в разделе "Документы" или уточнить у ответственного сотрудника.`;
    }

    showTypingIndicator() {
        const messagesContainer = document.getElementById('chat-messages');
        const typingElement = document.createElement('div');
        typingElement.className = 'message assistant-message typing';
        typingElement.id = 'typing-indicator';
        typingElement.innerHTML = `
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
        messagesContainer.appendChild(typingElement);
        this.scrollToBottom();
    }

    removeTypingIndicator() {
        const typingElement = document.getElementById('typing-indicator');
        if (typingElement) {
            typingElement.remove();
        }
    }

    clearChat() {
        if (confirm('Вы уверены, что хотите очистить историю чата?')) {
            this.chatHistory = [];
            document.getElementById('chat-messages').innerHTML = `
                <div class="welcome-message">
                    <div class="welcome-card">
                        <div class="ai-avatar">
                            <i class="bi bi-cpu"></i>
                        </div>
                        <h3>Добро пожаловать в Знаток!</h3>
                        <p>Задайте вопрос о внутренних документах, и я найду нужную информацию с помощью AI</p>
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
        const chatText = this.chatHistory.map(msg => 
            `${msg.role.toUpperCase()} (${msg.timestamp.toLocaleString()}): ${msg.content}`
        ).join('\n\n');
        
        const blob = new Blob([chatText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `znatok-chat-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    scrollToBottom() {
        const messagesContainer = document.getElementById('chat-messages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    saveChatHistory() {
        localStorage.setItem('znatok-chat-history', JSON.stringify(this.chatHistory));
    }

    loadChatHistory() {
        if (this.chatHistory.length > 0) {
            const messagesContainer = document.getElementById('chat-messages');
            messagesContainer.innerHTML = '';
            
            this.chatHistory.forEach(msg => {
                this.renderMessage(msg);
            });
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

        const fileInput = document.getElementById('fileInput');
        const departmentSelect = document.getElementById('departmentSelect');
        
        if (!fileInput || !departmentSelect) {
            this.showNotification('Форма загрузки недоступна', 'error');
            return;
        }

        // Устанавливаем файлы в input (для валидации)
        const dataTransfer = new DataTransfer();
        for (let file of files) {
            // Проверка типа файла (опционально на фронтенде)
            if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'].includes(file.type)) {
                this.showNotification('Поддерживаются только PDF, DOCX, TXT', 'error');
                return;
            }
            dataTransfer.items.add(file);
        }
        fileInput.files = dataTransfer.files;

        // Отправляем на сервер
        this.uploadFiles();
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "<")
            .replace(/>/g, ">")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async uploadFiles() {
        const fileInput = document.getElementById('fileInput');
        const departmentSelect = document.getElementById('departmentSelect');
        
        const files = fileInput.files;
        const department = departmentSelect?.value || 'all';

        if (files.length === 0) {
            this.showNotification('Выберите файлы для загрузки', 'warning');
            return;
        }

        const formData = new FormData();
        for (let file of files) {
            formData.append('files', file); // FastAPI ожидает list[UploadFile]
        }
        formData.append('department', department);

        try {
            this.showNotification('Загрузка и индексация...', 'info');
            
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                this.showNotification('✅ Документы успешно проиндексированы!', 'success');
                this.hideModal('uploadModal');
                // Опционально: обновить список документов
                // this.loadDocuments();
            } else {
                const errorText = await response.text();
                this.showNotification(`❌ Ошибка: ${errorText}`, 'error');
            }
        } catch (error) {
            this.showNotification(`❌ Сетевая ошибка: ${error.message}`, 'error');
            console.error('Upload error:', error);
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="bi bi-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
            </div>
        `;

        // Add to body
        document.body.appendChild(notification);

        // Animate in
        setTimeout(() => notification.classList.add('show'), 100);

        // Remove after delay
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

// Additional CSS for dynamic elements
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
`;

// Add dynamic styles to document
const styleSheet = document.createElement('style');
styleSheet.textContent = dynamicStyles;
document.head.appendChild(styleSheet);

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    window.znatokApp = new ZnatokApp();
});