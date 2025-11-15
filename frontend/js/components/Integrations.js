// frontend/js/Integrations.js

class IntegrationsManager {
    constructor(appInstance) {
        this.app = appInstance;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadIntegrationsStatus();
        this.updateWebhookUrl();
    }

    bindEvents() {
        // Telegram
        document.getElementById('save-telegram')?.addEventListener('click', () => {
            this.saveIntegration('telegram');
        });
        document.getElementById('test-telegram')?.addEventListener('click', () => {
            this.testIntegration('telegram');
        });

        // Bitrix24
        document.getElementById('save-bitrix24')?.addEventListener('click', () => {
            this.saveIntegration('bitrix24');
        });
        document.getElementById('test-bitrix24')?.addEventListener('click', () => {
            this.testIntegration('bitrix24');
        });

        // Обновление webhook URL при копировании (опционально)
        const webhookInput = document.getElementById('bitrix24-webhook-url');
        if (webhookInput) {
            webhookInput.addEventListener('click', () => {
                webhookInput.select();
                navigator.clipboard?.writeText(webhookInput.value)
                    .then(() => Notification.show('URL скопирован', 'info'))
                    .catch(() => {});
            });
        }
    }

    updateWebhookUrl() {
        const input = document.getElementById('bitrix24-webhook-url');
        if (input) {
            const url = `${window.location.origin}/bitrix24/webhook`;
            input.value = url;
        }
    }

    async loadIntegrationsStatus() {
        try {
            const res = await fetch('/api/integrations');
            if (!res.ok) throw new Error('Не удалось загрузить статус интеграций');
            const data = await res.json();

            this.updateStatus('telegram', data.telegram);
            this.updateStatus('bitrix24', data.bitrix24);

            // Подставляем сохранённые токены (если есть)
            const settingsRes = await fetch('/api/settings');
            if (settingsRes.ok) {
                const settings = await settingsRes.json();
                const integrations = settings.integrations || {};
                if (integrations.telegram?.bot_token) {
                    document.getElementById('telegram-bot-token').value = integrations.telegram.bot_token;
                }
                if (integrations.bitrix24?.client_secret) {
                    document.getElementById('bitrix24-secret').value = integrations.bitrix24.client_secret;
                }
            }
        } catch (err) {
            console.error('Ошибка загрузки интеграций:', err);
            Notification.show('Не удалось загрузить данные интеграций', 'error');
        }
    }

    updateStatus(name, statusData) {
        const el = document.getElementById(`${name}-status`);
        if (!el) return;

        const isConfigured = statusData.configured;
        el.textContent = isConfigured ? 'Активен' : 'Не настроен';
        el.className = `integration-status ${isConfigured ? 'status-active' : 'status-inactive'}`;
    }

    async saveIntegration(name) {
        let payload = {};

        if (name === 'telegram') {
            const token = document.getElementById('telegram-bot-token')?.value?.trim();
            if (!token) {
                Notification.show('Введите токен Telegram бота', 'warning');
                return;
            }
            payload = { telegram: { bot_token: token } };
        } else if (name === 'bitrix24') {
            const secret = document.getElementById('bitrix24-secret')?.value?.trim();
            if (!secret) {
                Notification.show('Введите Client Secret из Bitrix24', 'warning');
                return;
            }
            payload = { bitrix24: { client_secret: secret } };
        } else {
            Notification.show('Неизвестная интеграция', 'error');
            return;
        }

        try {
            const res = await fetch('/api/integrations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                Notification.show(`✅ Настройки ${name} сохранены`, 'success');
                await this.loadIntegrationsStatus(); // обновить статус
            } else {
                const errText = await res.text();
                Notification.show(`❌ Ошибка сохранения: ${errText}`, 'error');
            }
        } catch (err) {
            console.error(`Ошибка сохранения ${name}:`, err);
            Notification.show(`Не удалось сохранить настройки ${name}`, 'error');
        }
    }

    async testIntegration(name) {
        if (name === 'telegram') {
            Notification.show('Тест Telegram: отправьте сообщение боту', 'info');
            return;
        }

        if (name === 'bitrix24') {
            try {
                const res = await fetch('/bitrix24/test', { method: 'POST' });
                const data = await res.json();
                if (data.test_result?.success) {
                    Notification.show('✅ Bitrix24: тест пройден', 'success');
                } else {
                    Notification.show('❌ Bitrix24: тест не удался', 'error');
                }
            } catch (err) {
                console.error('Bitrix24 test error:', err);
                Notification.show('Ошибка при тестировании Bitrix24', 'error');
            }
            return;
        }

        Notification.show(`Тест для ${name} недоступен`, 'warning');
    }
}

export { IntegrationsManager };