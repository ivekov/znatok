// frontend/js/components/Chat.js
import { ApiClient } from '../core/ApiClient.js';
import { Notification } from '../core/Notification.js';
import { Storage } from '../core/Storage.js';
import { Utils } from '../core/Utils.js';

export class Chat {
    constructor() {
        this.history = Storage.get('znatok-chat-history', []);
        this.conversationId = Storage.get('znatok-conversation-id', null);
        this.init();
    }

    init() {
        this.renderHistory();
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('send-message')?.addEventListener('click', () => this.sendMessage());
        document.getElementById('message-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        document.getElementById('clear-chat')?.addEventListener('click', () => this.clear());
        document.getElementById('export-chat')?.addEventListener('click', () => this.export());
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('suggestion-chip')) {
                document.getElementById('message-input').value = e.target.textContent;
                this.sendMessage();
            }
        });
    }

    async sendMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        if (!text) return;

        this.addMessage('user', text);
        input.value = '';
        this.autoResizeTextarea();
        this.showTyping();

        try {
            const data = await ApiClient.post('/api/ask', {
                question: text,
                user_department: 'all',
                conversation_id: this.conversationId
            });

            this.conversationId = data.conversation_id;
            Storage.set('znatok-conversation-id', this.conversationId);

            let answerHtml = data.answer;
            if (data.sources?.length) {
                const sources = [...new Set(data.sources.map(s => s.source))];
                const chips = sources.map(src => 
                    `<span class="source-chip">${Utils.escapeHtml(src)}</span>`
                ).join('');
                answerHtml += `<div class="message-sources mt-2">Источники: ${chips}</div>`;
            }
            this.addMessage('assistant', answerHtml);

        } catch (error) {
            this.removeTyping();
            Notification.show(`❌ ${error.message || 'Не удалось получить ответ'}`, 'error');
            this.addMessage('system', error.message || 'Ошибка');
        }
    }

    addMessage(role, content) {
        const msg = { id: Date.now(), role, content, timestamp: new Date() };
        this.history.push(msg);
        this.renderMessage(msg);
        Storage.set('znatok-chat-history', this.history);
        this.scrollToBottom();
    }

    renderMessage(message) {
        const container = document.getElementById('chat-messages');
        if (message.role === 'user') {
            container.querySelector('.welcome-message')?.remove();
        }
        const el = document.createElement('div');
        el.className = `message ${message.role}-message`;
        el.innerHTML = this.getMessageHTML(message);
        container.appendChild(el);
    }

    getMessageHTML(msg) {
        const time = this.formatTime(msg.timestamp);
        const content = msg.content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
        return `
            <div class="message-bubble ${msg.role}">
                <div class="message-content">${content}</div>
                <div class="message-time">${time}</div>
            </div>
        `;
    }

    formatTime(date) {
        const now = new Date();
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } else if (now - date < 48 * 60 * 60 * 1000) {
            return `вчера ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
        } else if (now - date < 7 * 24 * 60 * 60 * 1000) {
            return date.toLocaleDateString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        }
    }

    showTyping() {
        const container = document.getElementById('chat-messages');
        const el = document.createElement('div');
        el.id = 'typing-indicator';
        el.className = 'message assistant-message typing';
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

    removeTyping() {
        document.getElementById('typing-indicator')?.remove();
    }

    renderHistory() {
    const container = document.getElementById('chat-messages');
    if (this.history.length === 0) return;

    container.innerHTML = '';
    this.history.forEach(msg => {
        // Приводим timestamp к Date, если это строка
        if (typeof msg.timestamp === 'string') {
            msg.timestamp = new Date(msg.timestamp);
        }
        this.renderMessage(msg);
    });
    this.scrollToBottom();
}

    clear() {
        if (!confirm('Очистить историю чата?')) return;
        this.history = [];
        this.conversationId = null;
        Storage.remove('znatok-chat-history');
        Storage.remove('znatok-conversation-id');
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
    }

    export() {
        const text = this.history.map(m => `${m.role}: ${m.content}`).join('\n\n');
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

    autoResizeTextarea() {
        const el = document.getElementById('message-input');
        if (el) {
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 120) + 'px';
        }
    }
}