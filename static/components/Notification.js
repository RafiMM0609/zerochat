class NotificationManager {
  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'notification-container';
    document.body.appendChild(this.container);
    this.icons = {
      success: '✅',
      error: '❌',
      info: 'ℹ️',
      warning: '⚠️'
    };
  }

  show(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    const icon = this.icons[type] || this.icons.info;
    
    notification.innerHTML = `
      <div class="notification-icon">${icon}</div>
      <div class="notification-content">${message}</div>
      <button class="notification-close">✕</button>
    `;
    
    this.container.appendChild(notification);
    
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.onclick = () => this.hide(notification);
    
    if (duration > 0) {
      setTimeout(() => this.hide(notification), duration);
    }
  }

  hide(notification) {
    if (notification.classList.contains('hiding')) return;
    
    notification.classList.add('hiding');
    notification.addEventListener('animationend', () => {
      notification.remove();
    });
  }
}

// Instantiate and expose globally immediately
// Since the script is loaded at the end of body or deferred, body will exist.
const manager = new NotificationManager();
window.showNotification = (message, type, duration) => manager.show(message, type, duration);

window.showConfirm = (message, title = 'Confirm Action', confirmText = 'Delete') => {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'confirm-modal';
    
    modal.innerHTML = `
      <div class="confirm-header">
        <span class="confirm-icon">⚠️</span>
        <h3 class="confirm-title">${title}</h3>
      </div>
      <div class="confirm-message">${message}</div>
      <div class="confirm-buttons">
        <button class="confirm-btn confirm-btn-cancel" id="confirm-cancel">Cancel</button>
        <button class="confirm-btn confirm-btn-danger" id="confirm-ok">${confirmText}</button>
      </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Trigger transition
    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });
    
    const cleanup = (result) => {
      overlay.classList.remove('active');
      const handleTransitionEnd = () => {
        overlay.removeEventListener('transitionend', handleTransitionEnd);
        overlay.remove();
      };
      overlay.addEventListener('transitionend', handleTransitionEnd);
      resolve(result);
    };
    
    overlay.querySelector('#confirm-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('#confirm-ok').addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
};
