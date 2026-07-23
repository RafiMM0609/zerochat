class NotificationManager {
  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'notification-container';
    document.body.appendChild(this.container);
    this.icons = {
      success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
      error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
      warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
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
        <span class="confirm-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
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
