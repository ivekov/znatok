// frontend/js/app.js
import { Storage } from './core/Storage.js';
import { Notification } from './core/Notification.js';

// Импортируем все компоненты
import { Chat } from './components/Chat.js';
import { Documents } from './components/Documents.js';
import { Settings } from './components/Settings.js';
import { Sources } from './components/Sources.js';
import { IntegrationsManager } from './components/Integrations.js';

class ZnatokApp {
    constructor() {
        this.currentSection = 'chat';
        this.theme = Storage.get('znatok-theme', 'dark');
        this.init();
    }

    init() {
        this.setTheme(this.theme);
        this.bindEvents();
        new Chat(); // теперь Chat определён
    }

    setTheme(theme) {
        this.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        Storage.set('znatok-theme', theme);
        document.querySelector('#themeToggle i').className = 
            theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon';
    }

    bindEvents() {
        document.getElementById('themeToggle')?.addEventListener('click', () => {
            this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
        });

        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchSection(e.currentTarget.dataset.section);
            });
        });
    }

    async switchSection(sectionName) {
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-section="${sectionName}"]`)?.classList.add('active');

        document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
        document.getElementById(`${sectionName}-section`)?.classList.add('active');

        this.currentSection = sectionName;

        // Инициализация компонентов (без ленивой загрузки)
        if (sectionName === 'documents') new Documents();
        if (sectionName === 'settings') new Settings();
        if (sectionName === 'integrations') new IntegrationsManager();
        if (sectionName === 'sources') new Sources();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.znatokApp = new ZnatokApp();
});