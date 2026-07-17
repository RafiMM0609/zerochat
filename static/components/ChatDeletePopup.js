class ChatDeletePopup {
  constructor() {
    this.createDOM();
  }

  createDOM() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'chat-delete-overlay';
    
    this.popup = document.createElement('div');
    this.popup.className = 'chat-delete-popup';
    
    this.popup.innerHTML = `
      <div class="chat-delete-header">
        <div class="chat-delete-header-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <h3>Chat Limit Reached</h3>
        <p>You can only have up to 10 chats. Please delete an older chat to create a new one.</p>
      </div>
      <div class="chat-delete-list" id="chat-delete-list">
        <!-- Chats injected here -->
      </div>
      <button class="chat-delete-close" id="chat-delete-close">Cancel</button>
    `;
    
    this.overlay.appendChild(this.popup);
    document.body.appendChild(this.overlay);

    this.overlay.querySelector('#chat-delete-close').addEventListener('click', () => this.hide());
  }

  async show() {
    this.overlay.classList.add('active');
    await this.loadChats();
  }

  hide() {
    this.overlay.classList.remove('active');
  }

  async loadChats() {
    const listEl = this.overlay.querySelector('#chat-delete-list');
    listEl.innerHTML = '<div style="text-align: center; color: #94a3b8; font-size: 14px; padding: 24px; font-weight: 500;">Loading chats...</div>';
    
    try {
      const res = await fetch('/api/chat', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('agnostic_token')}` }
      });
      const data = await res.json();
      
      listEl.innerHTML = '';
      if (!data.chats || data.chats.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; color: #94a3b8; font-size: 14px; padding: 24px; font-weight: 500;">No chats found.</div>';
        return;
      }

      data.chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chat-delete-item';
        
        const dateObj = new Date(chat.created_at);
        const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        
        let titleText = chat.title ? chat.title.replace(/</g, "&lt;").replace(/>/g, "&gt;") : 'Untitled Chat';
        if (!titleText.trim()) titleText = 'Untitled Chat';
        
        item.innerHTML = `
          <div class="chat-delete-item-info">
            <span class="chat-delete-item-title">${titleText}</span>
            <span class="chat-delete-item-date">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              ${dateStr}
            </span>
          </div>
          <button class="chat-delete-btn" data-id="${chat.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
            Delete
          </button>
        `;
        
        item.querySelector('.chat-delete-btn').addEventListener('click', async (e) => {
          await this.deleteChat(chat.id);
          if (window.onChatDeleted) window.onChatDeleted(chat.id);
        });
        
        listEl.appendChild(item);
      });
    } catch (e) {
      listEl.innerHTML = '<div style="text-align: center; color: #ef4444; font-size: 14px; padding: 24px; font-weight: 500;">Failed to load chats.</div>';
    }
  }

  async deleteChat(id) {
    try {
      const res = await fetch(`/api/chat/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('agnostic_token')}` }
      });
      if (res.ok) {
        await this.loadChats();
      }
    } catch (e) {
      console.error('Failed to delete chat', e);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.chatDeletePopup = new ChatDeletePopup();
});
