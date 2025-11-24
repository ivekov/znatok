// frontend/js/components/Settings.js
import { ApiClient } from '../core/ApiClient.js';
import { Notification } from '../core/Notification.js';

export class Settings {
    constructor() {
        this.bindEvents();
        this.load();
    }

    bindEvents() {
        document.getElementById('provider-select')?.addEventListener('change', (e) => {
            document.querySelectorAll('.provider-settings').forEach(el => el.classList.remove('active'));
            document.getElementById(`${e.target.value}-settings`)?.classList.add('active');
        });
        document.getElementById('temperature')?.addEventListener('input', (e) => {
            document.getElementById('temperature-value').textContent = e.target.value;
        });
        document.getElementById('save-settings')?.addEventListener('click', () => this.save());
        document.getElementById('test-connection')?.addEventListener('click', () => this.test());
    }

    async load() {
        try {
            const settings = await ApiClient.get('/api/settings');
            document.getElementById('provider-select').value = settings.current_provider;

            const map = {
                gigachat: { key: 'gigachat-api-key', model: 'gigachat-model' },
                yandex_gpt: { key: 'yandex-api-key', model: 'yandex-model' },
                mistral: { key: 'mistral-api-key', model: 'mistral-model' },
                ollama: { key: 'ollama-base-url', model: 'ollama-model' } // ← добавлено
            };

            for (const [provider, config] of Object.entries(settings.providers || {})) {
                const el = map[provider];
                if (el) {
                    document.getElementById(el.key).value = config.base_url || config.api_key || '';
                    document.getElementById(el.model).value = config.model || '';
                }
            }

            const first = Object.values(settings.providers || {})[0];
            if (first) {
                document.getElementById('temperature').value = first.temperature || 0.1;
                document.getElementById('temperature-value').textContent = first.temperature || 0.1;
                document.getElementById('max-tokens').value = first.max_tokens || 512;
            }
        } catch (e) {
            Notification.show('Ошибка загрузки настроек', 'error');
        }
    }

    async save() {
        const provider = document.getElementById('provider-select').value;
        const getVal = id => document.getElementById(id)?.value || '';

        const providers = {
            gigachat: {
                provider: 'gigachat',
                api_key: getVal('gigachat-api-key'),
                model: getVal('gigachat-model'),
                temperature: parseFloat(getVal('temperature')) || 0.1,
                max_tokens: parseInt(getVal('max-tokens')) || 512
            },
            yandex_gpt: {
                provider: 'yandex_gpt',
                api_key: getVal('yandex-api-key'),
                model: getVal('yandex-model'),
                temperature: parseFloat(getVal('temperature')) || 0.1,
                max_tokens: parseInt(getVal('max-tokens')) || 512
            },
            mistral: {
                provider: 'mistral',
                api_key: getVal('mistral-api-key'),
                model: getVal('mistral-model'),
                temperature: parseFloat(getVal('temperature')) || 0.1,
                max_tokens: parseInt(getVal('max-tokens')) || 512
            },
            ollama: { // ← добавлено
                provider: 'ollama',
                base_url: getVal('ollama-base-url'),
                model: getVal('ollama-model'),
                temperature: parseFloat(getVal('temperature')) || 0.1,
                max_tokens: parseInt(getVal('max-tokens')) || 512
            }
        };

        const integrations = (await ApiClient.get('/api/integrations')).integrations || {
            telegram: { bot_token: null },
            bitrix24: { client_secret: null }
        };

        try {
            await ApiClient.post('/api/settings', { current_provider: provider, providers, integrations });
            Notification.show('Настройки сохранены', 'success');
        } catch (e) {
            Notification.show('Ошибка сохранения', 'error');
        }
    }

    async test() {
        Notification.show('Проверка подключения...', 'info');
        try {
            await this.save();
            await ApiClient.post('/api/ask', {
                question: 'Привет! Ответь коротко: соединение установлено?',
                user_department: 'all'
            });
            Notification.show('✅ Подключение успешно!', 'success');
        } catch (e) {
            Notification.show('❌ Ошибка подключения', 'error');
        }
    }
}