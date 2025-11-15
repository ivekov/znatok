// frontend/js/components/Sources.js
import { ApiClient } from '../core/ApiClient.js';
import { Notification } from '../core/Notification.js';

export class Sources {
    constructor() {
        this.bindEvents();
        this.loadStatus();
    }

    bindEvents() {
        // Bitrix24 KB
        document.getElementById('save-bitrix24-kb')?.addEventListener('click', () => this.saveBitrix24KB());
        document.getElementById('sync-bitrix24-kb')?.addEventListener('click', () => this.syncBitrix24KB());
        document.getElementById('test-bitrix24-kb')?.addEventListener('click', () => this.testBitrix24KB());

        // Confluence
        document.getElementById('save-confluence')?.addEventListener('click', () => this.saveConfluence());
        document.getElementById('sync-confluence')?.addEventListener('click', () => this.syncConfluence());
        document.getElementById('test-confluence')?.addEventListener('click', () => this.testConfluence());
    }

    async loadStatus() {
        // Bitrix24 KB
        try {
            const status = await ApiClient.get('/api/sources/bitrix24/kb/status');
            const { enabled, domain, configured } = status;

            document.getElementById('bitrix24-kb-enabled').checked = enabled;
            document.getElementById('bitrix24-domain').value = domain || '';
            document.getElementById('bitrix24-access-token').value = configured ? '••••••••' : '';

            const meta = document.getElementById('bitrix24-kb-meta');
            const statusEl = document.getElementById('bitrix24-kb-status');

            if (configured) {
                statusEl.textContent = enabled ? 'Активен' : 'Отключён';
                statusEl.className = 'card-status status-active';
                meta.style.display = 'block';
                document.getElementById('bitrix24-last-sync').textContent =
                    status.last_sync ? new Date(status.last_sync).toLocaleString('ru-RU') : 'никогда';
            } else {
                statusEl.textContent = 'Не настроен';
                statusEl.className = 'card-status status-inactive';
                meta.style.display = 'none';
            }
        } catch (e) {
            console.error('Ошибка загрузки статуса Bitrix24 KB:', e);
        }

        // Confluence
        try {
            const status = await ApiClient.get('/api/sources/confluence/status');
            const { enabled, base_url, space_key, configured } = status;

            document.getElementById('confluence-enabled').checked = enabled;
            document.getElementById('confluence-base-url').value = base_url || '';
            document.getElementById('confluence-email').value = status.email || '';
            document.getElementById('confluence-api-token').value = configured ? '••••••••' : '';
            document.getElementById('confluence-space-key').value = space_key || '';

            const meta = document.getElementById('confluence-meta');
            const statusEl = document.getElementById('confluence-status');

            if (configured) {
                statusEl.textContent = enabled ? 'Активен' : 'Отключён';
                statusEl.className = 'card-status status-active';
                meta.style.display = 'block';
                document.getElementById('confluence-last-sync').textContent =
                    status.last_sync ? new Date(status.last_sync).toLocaleString('ru-RU') : 'никогда';
            } else {
                statusEl.textContent = 'Не настроен';
                statusEl.className = 'card-status status-inactive';
                meta.style.display = 'none';
            }
        } catch (e) {
            console.error('Ошибка загрузки статуса Confluence:', e);
        }
    }

    // === Bitrix24 KB ===
    async saveBitrix24KB() {
        const enabled = document.getElementById('bitrix24-kb-enabled').checked;
        const domain = document.getElementById('bitrix24-domain').value.trim();
        const token = document.getElementById('bitrix24-access-token').value.trim();

        if (enabled && (!domain || !token)) {
            Notification.show('Заполните домен и токен', 'warning');
            return;
        }

        const settings = await ApiClient.get('/api/settings');
        settings.knowledge_sources = settings.knowledge_sources || {};
        settings.knowledge_sources.bitrix24_kb = {
            enabled,
            domain: enabled ? domain : null,
            access_token: enabled ? token : null
        };

        try {
            await ApiClient.post('/api/settings', settings);
            Notification.show('Настройки Bitrix24 сохранены', 'success');
            this.loadStatus();
        } catch (e) {
            Notification.show('Ошибка сохранения', 'error');
        }
    }

    async syncBitrix24KB() {
        Notification.show('Синхронизация Bitrix24 запущена...', 'info');
        try {
            const res = await fetch('/api/sources/bitrix24/kb/sync', { method: 'POST' });
            const data = await res.json();
            if (data.status === 'ok') {
                Notification.show(`✅ Синхронизировано ${data.synced} статей`, 'success');
                this.loadStatus();
            } else {
                Notification.show(`❌ ${data.message}`, 'error');
            }
        } catch (e) {
            Notification.show('❌ Ошибка синхронизации Bitrix24', 'error');
        }
    }

    // === Confluence ===
    async saveConfluence() {
        const enabled = document.getElementById('confluence-enabled').checked;
        const base_url = document.getElementById('confluence-base-url').value.trim();
        const email = document.getElementById('confluence-email').value.trim();
        const token = document.getElementById('confluence-api-token').value.trim();
        const space_key = document.getElementById('confluence-space-key').value.trim();

        if (enabled && (!base_url || !email || !token)) {
            Notification.show('Заполните все обязательные поля', 'warning');
            return;
        }

        const settings = await ApiClient.get('/api/settings');
        settings.knowledge_sources = settings.knowledge_sources || {};
        settings.knowledge_sources.confluence = {
            enabled,
            base_url: enabled ? base_url : null,
            email: enabled ? email : null,
            api_token: enabled ? token : null,
            space_key: enabled && space_key ? space_key : null
        };

        try {
            await ApiClient.post('/api/settings', settings);
            Notification.show('Настройки Confluence сохранены', 'success');
            this.loadStatus();
        } catch (e) {
            Notification.show('Ошибка сохранения', 'error');
        }
    }

    async syncConfluence() {
        Notification.show('Синхронизация Confluence запущена...', 'info');
        try {
            const res = await fetch('/api/sources/confluence/sync', { method: 'POST' });
            const data = await res.json();
            if (data.status === 'ok') {
                Notification.show(`✅ Синхронизировано ${data.synced} статей`, 'success');
                this.loadStatus();
            } else {
                Notification.show(`❌ ${data.message}`, 'error');
            }
        } catch (e) {
            Notification.show('❌ Ошибка синхронизации Confluence', 'error');
        }
    }

    async testConfluence() {
        const base_url = document.getElementById('confluence-base-url').value.trim();
        const email = document.getElementById('confluence-email').value.trim();
        const token = document.getElementById('confluence-api-token').value.trim();

        if (!base_url || !email || !token) {
            Notification.show('Заполните все поля', 'warning');
            return;
        }

        try {
            Notification.show('Проверка подключения к Confluence...', 'info');
            const cleanUrl = base_url.replace(/\/$/, "");
            const testUrl = `${cleanUrl}/rest/api/space?limit=1`;

            const resp = await fetch(testUrl, {
                method: 'GET',
                headers: {
                    'Authorization': 'Basic ' + btoa(`${email}:${token}`)
                }
            });

            if (resp.ok) {
                Notification.show('✅ Подключение к Confluence успешно', 'success');
            } else {
                const text = await resp.text();
                Notification.show(`❌ Ошибка (${resp.status}): ${text.substring(0, 100)}`, 'error');
            }
        } catch (e) {
            Notification.show(`❌ Ошибка сети: ${e.message}`, 'error');
        }
    }

    async testBitrix24KB() {
        const domain = document.getElementById('bitrix24-domain').value.trim();
        const token = document.getElementById('bitrix24-access-token').value.trim();

        if (!domain || !token) {
            Notification.show('Заполните домен и токен', 'warning');
            return;
        }

        try {
            Notification.show('Проверка подключения к Bitrix24...', 'info');
            const url = `https://${domain}/rest/crm/knowledge-base/article.list`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auth: token })
            });

            if (resp.ok) {
                Notification.show('✅ Подключение к Bitrix24 успешно', 'success');
            } else {
                const data = await resp.json();
                Notification.show(`❌ Ошибка: ${data.error || 'неизвестная'}`, 'error');
            }
        } catch (e) {
            Notification.show(`❌ Ошибка сети: ${e.message}`, 'error');
        }
    }
}