// frontend/js/core/Notification.js

const NOTIFICATION_CONTAINER_ID = 'znatok-notifications';
const NOTIFICATION_GAP = 12; // px между уведомлениями

// Создаём общий контейнер один раз
function getOrCreateContainer() {
    let container = document.getElementById(NOTIFICATION_CONTAINER_ID);
    if (!container) {
        container = document.createElement('div');
        container.id = NOTIFICATION_CONTAINER_ID;
        container.style.position = 'fixed';
        container.style.top = '100px';
        container.style.right = '2rem';
        container.style.zIndex = '10000';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = `${NOTIFICATION_GAP}px`;
        container.style.maxWidth = '300px';
        document.body.appendChild(container);
    }
    return container;
}

export class Notification {
    static show(message, type = 'info') {
        const container = getOrCreateContainer();

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.transform = 'translateX(400px)';
        notification.style.transition = 'transform 0.3s ease';
        notification.style.background = 'var(--bg-glass)';
        notification.style.backdropFilter = 'blur(20px)';
        notification.style.border = '1px solid var(--border-light)';
        notification.style.borderRadius = '12px';
        notification.style.padding = '1rem 1.5rem';
        notification.style.boxShadow = 'var(--shadow-sm)';
        notification.style.color = 'var(--text-primary)';
        notification.style.maxWidth = '300px';
        notification.style.opacity = '0';
        notification.style.pointerEvents = 'none';

        notification.innerHTML = `
            <div class="notification-content">
                <i class="bi bi-${this.getIcon(type)}"></i>
                <span>${message}</span>
            </div>
        `;

        container.appendChild(notification);

        // Показываем
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateX(0)';
            notification.style.pointerEvents = 'auto';
        });

        // Автоскрытие
        setTimeout(() => {
            notification.style.transform = 'translateX(400px)';
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                    // Удаляем контейнер, если пуст
                    if (container.children.length === 0) {
                        container.remove();
                    }
                }
            }, 300);
        }, 3000);
    }

    static getIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-triangle',
            warning: 'exclamation-circle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }
}