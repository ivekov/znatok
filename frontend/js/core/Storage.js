// frontend/js/core/Storage.js
export class Storage {
    static get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.warn(`Failed to parse ${key} from localStorage`);
            return defaultValue;
        }
    }

    static set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error(`Failed to set ${key} in localStorage`, e);
        }
    }

    static remove(key) {
        localStorage.removeItem(key);
    }
}