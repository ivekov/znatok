// frontend/js/core/ApiClient.js
export class ApiClient {
    static async request(url, options = {}) {
        const defaultOpts = {
            headers: { 'Content-Type': 'application/json' },
            ...options
        };

        try {
            const response = await fetch(url, defaultOpts);
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text}`);
            }
            return await response.json();
        } catch (error) {
            if (error.message.includes('Failed to fetch')) {
                throw new Error('Ошибка соединения с сервером');
            }
            throw error;
        }
    }

    static async post(url, body) {
        return this.request(url, { method: 'POST', body: JSON.stringify(body) });
    }

    static async get(url) {
        return this.request(url);
    }

    static async delete(url) {
        const response = await fetch(url, { method: 'DELETE' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.ok;
    }
}