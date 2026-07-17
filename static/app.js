const { animate } = Motion;
const API_BASE = '/api';

let token = localStorage.getItem('agnostic_token');
let isLoginMode = true;
let selectedFile = null;

// DOM Elements
const authView = document.getElementById('auth-view');
const mainView = document.getElementById('main-view');
const authForm = document.getElementById('auth-form');
const authBtn = document.getElementById('auth-btn');

// Track particle animations for cleanup
let welcomeParticleAnimations = [];

// Restore sidebar state
let sidebarCollapsed = localStorage.getItem('agnostic_sidebar') === 'collapsed';

// Map path → tabId
const PATH_TAB_MAP = {
  '/overview': 'overview',
  '/chat': 'chat',
  '/knowledge': 'knowledge',
  '/graph': 'graph',
  '/security': 'security',
  '/settings': 'settings',
};

// Map tabId → breadcrumb path parts
const BREADCRUMB_MAP = {
  'overview': ['Agnostic', 'Analytics', 'Overview'],
  'chat': ['Agnostic', 'Workspace', 'Chat'],
  'knowledge': ['Agnostic', 'Index', 'Knowledge Base'],
  'graph': ['Agnostic', 'Graph', 'Knowledge Graph'],
  'security': ['Agnostic', 'Hardening', 'Security Audit'],
  'settings': ['Agnostic', 'Configuration', 'Settings'],
};

function updateBreadcrumbs(tabId) {
  const parts = BREADCRUMB_MAP[tabId] || ['Agnostic', 'Workspace', tabId];
  const container = document.getElementById('breadcrumb-current-path');
  if (container) {
    container.innerHTML = parts.map((part, index) => {
      const isLast = index === parts.length - 1;
      if (isLast) {
        return `<span class="breadcrumb-item active">${escapeHtml(part)}</span>`;
      }
      return `
        <span class="breadcrumb-item">${escapeHtml(part)}</span>
        <span class="breadcrumb-separator">/</span>
      `;
    }).join('');
  }
  document.title = `Agnostic AI | ${parts[parts.length - 1]}`;
}

// Init — routing
const currentPath = window.location.pathname;
const isLoginPage = currentPath === '/login';

if (token && isLoginPage) {
  // Has token but on login page → go to overview
  history.replaceState(null, '', '/overview');
  showMainApp();
} else if (token && currentPath === '/') {
  // Has token, root → show overview
  history.replaceState(null, '', '/overview');
  showMainApp();
} else if (token) {
  // Has token, specific path → show that tab
  showMainApp();
} else if (!token && isLoginPage) {
  // No token, login page → do nothing (show auth view)
} else {
  // No token, not login page → redirect to login
  window.location.replace('/login');
}

let isFlipping = false;

async function toggleAuthMode() {
  if (isFlipping) return;
  isFlipping = true;

  const formInner = document.querySelector('.auth-form-inner');
  
  // Fade out
  if (formInner) await animate(formInner, { opacity: [1, 0], y: [0, -8] }, { duration: 0.15, easing: "ease-in" }).finished;

  isLoginMode = !isLoginMode;
  const toggleEl = document.querySelector('.toggle-auth');
  if (toggleEl) {
    toggleEl.innerHTML = isLoginMode ? "Don't have an account? <strong>Register</strong>" : "Already have an account? <strong>Login</strong>";
  }
  authBtn.innerText = isLoginMode ? 'Log In' : 'Register';

  // Fade in
  if (formInner) await animate(formInner, { opacity: [0, 1], y: [8, 0] }, { duration: 0.2, easing: "ease-out" }).finished;
  
  isFlipping = false;
}

async function loginAsGuest() {
  const guestBtn = document.getElementById('guest-btn');
  if (guestBtn) {
    guestBtn.disabled = true;
    guestBtn.innerText = 'Logging in...';
  }
  try {
    const res = await fetch(API_BASE + '/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Guest login failed');

    token = data.token;
    localStorage.setItem('agnostic_token', token);
    showMainApp();
  } catch (err) {
    showNotification(err.message, 'error');
  } finally {
    if (guestBtn) {
      guestBtn.disabled = false;
      guestBtn.innerText = 'Login as Guest';
    }
  }
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const endpoint = isLoginMode ? '/auth/login' : '/auth/register';

  try {
    const res = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Auth failed');

    if (isLoginMode) {
      token = data.token;
      localStorage.setItem('agnostic_token', token);
      showMainApp();
    } else {
      await toggleAuthMode();
      showNotification('Registration successful! Please login.', 'success');
    }
  } catch (err) {
    showNotification(err.message, 'error');
  }
});

function logout() {
  localStorage.removeItem('agnostic_token');
  token = null;
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
  mainView.classList.remove('active');
  authView.classList.add('active');
  history.pushState(null, '', '/login');
  animate(authView, { opacity: [0, 1] }, { duration: 0.5 });

  const indicator = document.getElementById('nav-indicator');
  if (indicator) {
    indicator.style.opacity = '0';
  }
}

function manageStatusContainerLocation() {
  // No-op: kept for call compatibility
}

window.addEventListener('resize', manageStatusContainerLocation);

function toggleMobileMenu() {
  const navLinks = document.getElementById('nav-links-menu');
  const hamburger = document.getElementById('hamburger-btn');
  if (navLinks) {
    navLinks.classList.toggle('active');
  }
  if (hamburger) {
    hamburger.classList.toggle('active');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebarCollapsed = !sidebarCollapsed;
  sidebar.classList.toggle('collapsed', sidebarCollapsed);
  localStorage.setItem('agnostic_sidebar', sidebarCollapsed ? 'collapsed' : '');
}

function showMainApp() {
  authView.classList.remove('active');
  // Safety: cap welcome animation at 8s so main view always appears
  withTimeout(playWelcomeAnimation(), 8000, 'Welcome animation').catch(err => {
    console.warn('Welcome animation failed or timed out, skipping:', err.message || err);
  }).then(() => {
    // Always show main view even if animation fails
    const overlay = document.getElementById('welcome-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.style.opacity = '0';
    }
    mainView.classList.add('active');
    // Clear any lingering Motion inline styles before animating
    mainView.style.opacity = '';
    mainView.style.transform = '';
    animate(mainView, { opacity: [0, 1] }, { duration: 0.5 });
    // Safety net: ensure mainView is fully visible after animation duration
    setTimeout(() => {
      mainView.style.opacity = '1';
    }, 600);
    loadData();
    // Switch to tab based on current URL after load
    const path = window.location.pathname;
    const initialTab = PATH_TAB_MAP[path] || 'overview';
    // Ensure URL is correct
    if (!PATH_TAB_MAP[path]) {
      history.replaceState({ tab: initialTab }, '', '/' + initialTab);
    }
    setTimeout(() => {
      // Restore sidebar collapsed state
      if (sidebarCollapsed) {
        document.getElementById('sidebar')?.classList.add('collapsed');
      }
      switchTab(initialTab, true);
      initNavIndicator();
      initUploadZone();
      manageStatusContainerLocation();
    }, 100);
  });
}

async function playWelcomeAnimation() {
  const overlay = document.getElementById('welcome-overlay');
  const subtitle = document.getElementById('welcome-subtitle');
  const letters = document.querySelectorAll('.welcome-letter');
  const line = document.getElementById('welcome-line');
  const tagline = document.getElementById('welcome-tagline');
  const particlesContainer = document.getElementById('welcome-particles');

  // --- Full reset of all previous animation state ---
  // Stop lingering particle animations
  welcomeParticleAnimations.forEach(a => a.stop());
  welcomeParticleAnimations = [];

  // Reset overlay: ensure it's visible and opacity is 1 BEFORE showing
  overlay.style.opacity = '1';
  overlay.style.transform = '';
  overlay.classList.add('active');
  // Force browser reflow so the opacity reset is applied before animations start
  void overlay.offsetHeight;

  // Reset child elements (clear Motion inline styles)
  subtitle.style.opacity = '0';
  subtitle.style.transform = '';
  letters.forEach(l => {
    l.style.opacity = '0';
    l.style.transform = '';
  });
  line.style.opacity = '0';
  line.style.width = '0';
  tagline.style.opacity = '0';
  tagline.style.transform = '';

  // Create floating particles
  createWelcomeParticles(particlesContainer);

  try {
    // Sequence the animation
    await sleep(300);

    // 1. Fade in "Welcome to"
    await animate(subtitle, { opacity: [0, 1], y: [10, 0] }, { duration: 0.6, easing: 'ease-out' }).finished;

    await sleep(200);

    // 2. Reveal "Agnostic" letters one by one with spring-like bounce
    const letterAnimations = [];
    for (let i = 0; i < letters.length; i++) {
      const anim = animate(letters[i], {
        opacity: [0, 1],
        y: [40, 0],
        scale: [0.5, 1]
      }, {
        duration: 0.5,
        delay: i * 0.07,
        easing: [0.22, 1, 0.36, 1]
      });
      letterAnimations.push(anim);
    }
    await Promise.all(letterAnimations.map(a => a.finished));

    await sleep(150);

    // 3. Expand the decorative line
    await animate(line, {
      opacity: [0, 1],
      width: [0, 120]
    }, { duration: 0.6, easing: 'ease-out' }).finished;

    await sleep(100);

    // 4. Fade in tagline
    await animate(tagline, { opacity: [0, 1], y: [8, 0] }, { duration: 0.5, easing: 'ease-out' }).finished;

    // Hold the welcome screen for a moment
    await sleep(1200);
  } catch (err) {
    console.error('Welcome animation sequence error:', err);
  } finally {
    // Always cleanup, even if animation sequence failed
    // 5. Stop particle animations
    welcomeParticleAnimations.forEach(a => a.stop());
    welcomeParticleAnimations = [];

    // 6. Fade everything out
    try {
      await animate(overlay, { opacity: [1, 0] }, { duration: 0.6, easing: 'ease-in' }).finished;
    } catch (e) {
      overlay.style.opacity = '0';
    }

    // Cleanup: hide overlay and reset for next time
    overlay.classList.remove('active');
    overlay.style.opacity = '';
    overlay.style.transform = '';
    particlesContainer.innerHTML = '';
  }
}

function createWelcomeParticles(container) {
  container.innerHTML = '';
  const count = 20;
  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    particle.className = 'welcome-particle';
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const size = 2 + Math.random() * 4;
    particle.style.left = x + '%';
    particle.style.top = y + '%';
    particle.style.width = size + 'px';
    particle.style.height = size + 'px';
    container.appendChild(particle);

    // Track animation reference for cleanup
    const anim = animate(particle, {
      opacity: [0, 0.4 + Math.random() * 0.3, 0],
      y: [0, -(30 + Math.random() * 60)],
      x: [(Math.random() - 0.5) * 40]
    }, {
      duration: 2 + Math.random() * 2,
      delay: Math.random() * 1.5,
      easing: 'ease-out',
      repeat: Infinity
    });
    welcomeParticleAnimations.push(anim);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timed out')), ms))
  ]);
}

function switchTab(tabId, silent = false) {
  updateBreadcrumbs(tabId);
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));

  const targetTab = document.getElementById(tabId + '-tab');
  if (!targetTab) return;
  targetTab.classList.add('active');
  
  const targetLi = document.getElementById('nav-' + tabId);
  if (targetLi) {
    targetLi.classList.add('active');
    updateNavIndicator(targetLi);
  }

  // Update URL
  if (!silent) {
    const path = '/' + tabId;
    history.pushState({ tab: tabId }, '', path);
  }

  // Close mobile menu if open
  if (window.innerWidth <= 768) {
    const navLinks = document.getElementById('nav-links-menu');
    const hamburger = document.getElementById('hamburger-btn');
    if (navLinks && navLinks.classList.contains('active')) {
      navLinks.classList.remove('active');
      if (hamburger) hamburger.classList.remove('active');
    }
  }

  if (tabId === 'security') {
    loadSecurityDashboard();
  }
  if (tabId === 'graph') {
    loadGraphData();
  }
  if (tabId === 'settings') {
    updateTutorialSnippets();
  }
  if (tabId === 'overview') {
    loadUsageLogs();
  }

  animate(targetTab, { opacity: [0, 1], y: [10, 0] }, { duration: 0.4 });
}

// Handle browser back/forward
window.addEventListener('popstate', (e) => {
  const path = window.location.pathname;
  const tabId = PATH_TAB_MAP[path] || 'overview';
  switchTab(tabId, true);
});

// ---- Navigation sliding indicator ----
function initNavIndicator() {
  const indicator = document.getElementById('nav-indicator');
  const links = document.querySelectorAll('.nav-links li');
  const activeLi = document.querySelector('.nav-links li.active');

  if (!indicator) return;

  if (activeLi) {
    updateNavIndicator(activeLi, true);
  }

  links.forEach(link => {
    link.addEventListener('mouseenter', () => {
      updateNavIndicator(link);
      if (!link.classList.contains('active')) {
        animate(indicator, { opacity: 0.5 }, { duration: 0.2 });
      } else {
        animate(indicator, { opacity: 1 }, { duration: 0.2 });
      }
    });
  });

  const navLinksContainer = document.querySelector('.nav-links');
  if (navLinksContainer) {
    navLinksContainer.addEventListener('mouseleave', () => {
      const activeLi = document.querySelector('.nav-links li.active');
      if (activeLi) {
        updateNavIndicator(activeLi);
        animate(indicator, { opacity: 1 }, { duration: 0.2 });
      } else {
        animate(indicator, { opacity: 0 }, { duration: 0.2 });
      }
    });
  }

  window.addEventListener('resize', () => {
    const activeLi = document.querySelector('.nav-links li.active');
    if (activeLi) {
      updateNavIndicator(activeLi, true);
    }
  });
}

function updateNavIndicator(targetLi, immediate = false) {
  const indicator = document.getElementById('nav-indicator');
  if (!indicator || !targetLi) return;

  // Don't show indicator when sidebar is collapsed
  if (document.getElementById('sidebar')?.classList.contains('collapsed')) {
    indicator.style.opacity = '0';
    return;
  }

  const top = targetLi.offsetTop;
  const height = targetLi.offsetHeight;

  indicator.style.opacity = '1';

  if (immediate) {
    indicator.style.top = `${top}px`;
    indicator.style.height = `${height}px`;
  } else {
    animate(indicator, {
      top: top,
      height: height
    }, {
      duration: 0.25,
      easing: "ease-out"
    });
  }
}

// Load initial data
let statusInterval = null;

async function loadData() {
  loadPersona();
  loadApiKeys();
  loadDocuments();
  loadSecurityDashboard();
  loadChatSessions();
  loadUsageLogs();
  updateStatus();
  if (statusInterval) clearInterval(statusInterval);
  statusInterval = setInterval(updateStatus, 10000);
}

async function updateStatus() {
  try {
    const res = await fetch(API_BASE + '/status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();

    ['db','openrouter','embedding'].forEach((key) => {
      const overview = document.getElementById('status-' + key + '-overview');
      const ok = key === 'embedding' ? !!data.embedding : !!data[key];
      if (overview) updateStatusDot('status-' + key + '-overview', ok);
    });
  } catch (err) {
    ['db','openrouter','embedding'].forEach((key) => {
      updateStatusDot('status-' + key + '-overview', false);
    });
  }
}

function updateStatusDot(id, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  if (ok) {
    el.classList.add('ok');
  } else {
    el.classList.remove('ok');
  }
}
// ---- Chat Module ----
let activeChatId = null;
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatHistory = document.getElementById('chat-history');

async function loadChatSessions() {
  try {
    const res = await fetch(API_BASE + '/chat', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    const list = document.getElementById('chat-sessions-list');
    const selector = document.getElementById('mobile-chat-selector');
    if (selector) selector.innerHTML = '<option value="">Select a chat...</option>';
    if (!list) return;
    list.innerHTML = '';
    
    if (data.chats) {
      data.chats.forEach(c => {
        const div = document.createElement('div');
        div.className = 'chat-session-item' + (c.id === activeChatId ? ' active' : '');
        div.style.padding = '10px';
        div.style.borderRadius = '6px';
        div.style.cursor = 'pointer';
        div.style.color = '#e2e8f0';
        div.style.fontSize = '14px';
        div.style.border = '1px solid transparent';
        div.style.transition = 'all 0.2s';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';

        if (c.id === activeChatId) {
          div.style.background = 'rgba(255,255,255,0.1)';
          div.style.borderColor = 'rgba(255,255,255,0.2)';
        }
        
        div.addEventListener('mouseenter', () => { if (c.id !== activeChatId) div.style.background = 'rgba(255,255,255,0.05)'; });
        div.addEventListener('mouseleave', () => { if (c.id !== activeChatId) div.style.background = 'transparent'; });
        
        div.innerHTML = `
          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(c.title || 'New Chat')}</span>
          <span class="delete-chat-btn" style="padding: 2px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.1); color: #ef4444; font-size: 10px; font-weight: 600; cursor: pointer;" title="Delete Chat">DEL</span>
        `;
        
        div.addEventListener('click', (e) => {
          if (e.target.closest('.delete-chat-btn')) {
            deleteChat(c.id);
          } else {
            selectChat(c.id, c.title);
          }
        });
        
        list.appendChild(div);

        if (selector) {
          const option = document.createElement('option');
          option.value = c.id;
          option.innerText = c.title || 'New Chat';
          if (c.id === activeChatId) option.selected = true;
          selector.appendChild(option);
        }
      });
    }
  } catch (e) {
    console.error('Failed to load chat sessions', e);
    showNotification('Failed to load chat sessions', 'error');
  }
}

async function deleteChat(id) {
  if (!await showConfirm('Are you sure you want to delete this chat?', 'Delete Chat')) return;
  try {
    const res = await fetch(API_BASE + `/chat/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      if (activeChatId === id) {
        activeChatId = null;
        document.getElementById('chat-history').innerHTML = '';
        const header = document.getElementById('active-chat-header');
        if (header) header.style.display = 'none';
      }
      loadChatSessions();
    } else {
      showNotification('Failed to delete chat', 'error');
    }
  } catch (e) {
    console.error('Error deleting chat', e);
  }
}

const mobileChatSelector = document.getElementById('mobile-chat-selector');
if (mobileChatSelector) {
  mobileChatSelector.addEventListener('change', (e) => {
    const selectedId = e.target.value;
    if (selectedId) {
      const title = e.target.options[e.target.selectedIndex].text;
      selectChat(parseInt(selectedId), title);
    }
  });
}

async function createNewChat(title = 'New Chat') {
  try {
    const res = await fetch(API_BASE + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ title })
    });
    
    if (res.status === 403) {
      const data = await res.json();
      if (data.requireDelete && window.chatDeletePopup) {
        window.chatDeletePopup.show();
      }
      return null;
    }
    
    const data = await res.json();
    if (data.id) {
      await loadChatSessions();
      selectChat(data.id, data.title);
      return data.id;
    }
  } catch (e) {
    console.error('Failed to create chat', e);
    showNotification('Failed to create a new chat', 'error');
  }
  return null;
}

async function selectChat(id, title) {
  switchTab('chat');
  activeChatId = id;
  const header = document.getElementById('active-chat-header');
  const headerTitle = document.getElementById('active-chat-title');
  if (header) header.style.display = 'flex';
  if (headerTitle) headerTitle.innerText = title;
  
  const historyEl = document.getElementById('chat-history');
  if (historyEl) historyEl.innerHTML = '';
  await loadChatSessions(); // update active styling
  
  // load messages
  try {
    const res = await fetch(API_BASE + `/chat/${id}/messages`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data.messages) {
      data.messages.forEach(m => appendMessage(m.role === 'assistant' || m.role === 'ai' ? 'ai' : m.role, m.content, false));
    }
  } catch (e) {
    console.error('Failed to load messages', e);
  }
}

const newChatBtn = document.getElementById('new-chat-btn');
if (newChatBtn) {
  newChatBtn.addEventListener('click', () => {
    createNewChat('Chat ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  });
}

window.onChatDeleted = (id) => {
  if (activeChatId === id) {
    activeChatId = null;
    document.getElementById('chat-history').innerHTML = '';
    const header = document.getElementById('active-chat-header');
    if (header) header.style.display = 'none';
  }
  loadChatSessions();
};

function renderMarkdown(text) {
  if (!window.marked) return text;
  try {
    return marked.parse ? marked.parse(text) : marked(text);
  } catch (e) {
    console.error("Markdown parsing failed", e);
    return text;
  }
}

let activeChatDotsAnimation = null;

function showChatLoading(element, statusText = 'Berpikir') {
  const contentDiv = element.querySelector('.msg-content') || element;
  contentDiv.innerHTML = `
    <div class="chat-loading-wrapper" style="display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 14px;">
      <div class="chat-loading-dots" style="margin: 0;">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
      </div>
      <span class="chat-loading-text" id="chat-loading-text">${statusText}...</span>
    </div>
  `;
  const dots = (contentDiv || element).querySelectorAll('.loading-dot');
  const animations = [];
  dots.forEach((dot, index) => {
    const anim = animate(dot, {
      y: [0, -6, 0],
      opacity: [0.4, 1, 0.4]
    }, {
      duration: 0.8,
      repeat: Infinity,
      delay: index * 0.15,
      easing: "ease-in-out"
    });
    animations.push(anim);
  });
  activeChatDotsAnimation = animations;
}

function stopChatLoading() {
  if (activeChatDotsAnimation) {
    activeChatDotsAnimation.forEach(anim => anim.stop());
    activeChatDotsAnimation = null;
  }
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  if (!activeChatId) {
    const newId = await createNewChat('Chat ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    if (!newId) return; // popup shown or failed
  }

  appendMessage('user', text);
  chatInput.value = '';

  const aiMessageDiv = appendMessage('ai', '');
  aiMessageDiv.classList.add('streaming');
  showChatLoading(aiMessageDiv);

  let aiText = '';

  try {
    const res = await fetch(API_BASE + '/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: text, chatId: activeChatId })
    });

    if (!res.ok) throw new Error('Failed to fetch from server');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep the last incomplete line in the buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.error) {
              stopChatLoading();
              aiText = '[Error] ' + data.error;
              const msgContent = aiMessageDiv.querySelector('.msg-content');
              if (msgContent) msgContent.innerHTML = renderMarkdown(aiText);
            } else if (data.progress) {
              const loadingText = aiMessageDiv.querySelector('#chat-loading-text');
              if (loadingText) {
                loadingText.innerText = data.progress;
              }
            } else if (data.text) {
              if (activeChatDotsAnimation) {
                stopChatLoading();
                aiText = '';
                const msgContent = aiMessageDiv.querySelector('.msg-content');
                if (msgContent) msgContent.innerHTML = '';
              }
              aiText += data.text;
              const msgContent = aiMessageDiv.querySelector('.msg-content');
              if (msgContent) msgContent.innerHTML = renderMarkdown(aiText);
            } else if (data.newTitle) {
               const titleEl = document.getElementById('active-chat-title');
               if (titleEl) titleEl.innerText = data.newTitle;
               loadChatSessions(); // Update the sidebar
            }
            chatHistory.scrollTop = chatHistory.scrollHeight;
          } catch (e) { }
        }
      }
    }
  } catch (err) {
    stopChatLoading();
    const msgContent = aiMessageDiv.querySelector('.msg-content');
    if (msgContent) msgContent.innerHTML = renderMarkdown('[Error connecting to AI]');
  } finally {
    stopChatLoading();
    aiMessageDiv.classList.remove('streaming');
  }
});

function appendMessage(sender, text, animateMsg = true) {
  const div = document.createElement('div');
  div.className = `message ${sender}`;

  // Add author label
  const authorLabel = document.createElement('div');
  authorLabel.className = 'msg-author-label';
  authorLabel.innerText = sender === 'ai' ? 'Assistant' : 'You';
  div.appendChild(authorLabel);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'msg-content';
  if (sender === 'ai' || sender === 'assistant') {
    contentDiv.innerHTML = renderMarkdown(text);
  } else {
    contentDiv.innerText = text;
  }
  div.appendChild(contentDiv);

  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  if (animateMsg) {
    animate(div, { opacity: [0, 1], y: [20, 0] }, { duration: 0.3 });
  } else {
    div.style.opacity = '1';
    div.style.transform = 'translateY(0)';
  }
  return div;
}

// ---- Settings: Persona ----
async function loadPersona() {
  try {
    const res = await fetch(API_BASE + '/settings/persona', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data.system_prompt) {
      document.getElementById('persona-input').value = data.system_prompt;
    }
  } catch (e) { }
}

async function savePersona() {
  const prompt = document.getElementById('persona-input').value;
  try {
    const res = await fetch(API_BASE + '/settings/persona', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ system_prompt: prompt })
    });
    if (res.ok) {
      showNotification('Persona saved!', 'success');
    }
  } catch (e) { }
}

// ---- Settings: API Keys ----
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function copyToClipboard(text, buttonElement) {
  navigator.clipboard.writeText(text).then(() => {
    showNotification('Copied to clipboard!', 'success', 2000);
    const originalText = buttonElement.innerText;
    buttonElement.innerText = '✅';
    buttonElement.style.color = '#10b981';
    buttonElement.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    setTimeout(() => {
      buttonElement.innerText = originalText;
      buttonElement.style.color = '';
      buttonElement.style.borderColor = '';
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy text: ', err);
  });
}

let currentTutorialTab = 'curl';
let firstApiKey = 'YOUR_API_KEY';

function updateTutorialSnippets() {
  const origin = window.location.origin;
  const endpoint = `${origin}/api/chat/completions`;
  
  const endpointEl = document.getElementById('api-endpoint-url');
  if (endpointEl) {
    endpointEl.innerText = endpoint;
  }
  
  const codeBlock = document.getElementById('tutorial-code-block');
  if (!codeBlock) return;
  
  let code = '';
  let langClass = '';
  
  if (currentTutorialTab === 'curl') {
    langClass = 'language-bash';
    code = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${firstApiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "Hello, how are you?",
    "chatId": 1
  }'`;
  } else if (currentTutorialTab === 'js') {
    langClass = 'language-javascript';
    code = `// Fetch example (Streaming API response)
const response = await fetch('${endpoint}', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${firstApiKey}',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: 'Hello, how are you?',
    chatId: 1 // optional
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  
  // Parse Server-Sent Events (SSE)
  const lines = chunk.split('\\n');
  for (const line of lines) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.text) {
          process.stdout.write(data.text);
        }
      } catch (e) {}
    }
  }
}`;
  } else if (currentTutorialTab === 'python') {
    langClass = 'language-python';
    code = `import requests
import json

url = "${endpoint}"
headers = {
    "Authorization": "Bearer ${firstApiKey}",
    "Content-Type": "application/json"
}
data = {
    "message": "Hello, how are you?",
    "chatId": 1 # optional
}

response = requests.post(url, headers=headers, json=data, stream=True)
for line in response.iter_lines():
    if line:
        decoded_line = line.decode('utf-8')
        if decoded_line.startswith('data: ') and decoded_line != 'data: [DONE]':
            try:
                data_json = json.loads(decoded_line[6:])
                if 'text' in data_json:
                    print(data_json['text'], end='', flush=True)
            except Exception:
                pass`;
  }
  
  codeBlock.innerHTML = `<code class="${langClass}">${escapeHtml(code)}</code>`;
}

function switchTutorialTab(tabId) {
  currentTutorialTab = tabId;
  
  const buttons = document.querySelectorAll('.tutorial-tabs .tab-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = Array.from(buttons).find(btn => btn.getAttribute('onclick')?.includes(tabId));
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
  
  updateTutorialSnippets();
}

function copyEndpointUrl() {
  const endpointText = document.getElementById('api-endpoint-url').innerText;
  const copyBtn = document.querySelector('.copy-url-btn');
  copyToClipboard(endpointText, copyBtn);
}

function copyTutorialCode() {
  const codeEl = document.querySelector('#tutorial-code-block code');
  if (!codeEl) return;
  const copyBtn = document.querySelector('.copy-code-btn');
  copyToClipboard(codeEl.innerText, copyBtn);
}

async function loadApiKeys() {
  const res = await fetch(API_BASE + '/settings/api-keys', { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  
  if (data.keys && data.keys.length > 0) {
    firstApiKey = data.keys[0].key;
  } else {
    firstApiKey = 'YOUR_API_KEY';
  }
  
  updateTutorialSnippets();

  const list = document.getElementById('api-key-list');
  list.innerHTML = '';
  data.keys.forEach(k => {
    const li = document.createElement('li');
    li.className = 'api-key-item';
    li.innerHTML = `
      <code>${escapeHtml(k.key)}</code>
      <div class="api-key-actions">
        <button class="copy-key-btn" title="Copy API Key" aria-label="Copy API Key">📋</button>
        <button class="delete-key-btn" title="Delete API Key" aria-label="Delete API Key">🗑️</button>
      </div>
    `;
    
    li.querySelector('.copy-key-btn').addEventListener('click', (e) => {
      copyToClipboard(k.key, e.currentTarget);
    });

    li.querySelector('.delete-key-btn').addEventListener('click', () => {
      deleteApiKey(k.id);
    });

    list.appendChild(li);
    animate(li, { opacity: [0, 1] }, { duration: 0.3 });
  });
}

async function generateApiKey() {
  const res = await fetch(API_BASE + '/settings/api-keys', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
  if (res.ok) {
    showNotification('New API Key generated successfully!', 'success');
    loadApiKeys();
  } else {
    showNotification('Failed to generate API Key', 'error');
  }
}

async function deleteApiKey(id) {
  if (!await showConfirm('Are you sure you want to delete this API Key?', 'Delete API Key')) return;
  const res = await fetch(API_BASE + `/settings/api-keys/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
  if (res.ok) {
    showNotification('API Key deleted successfully', 'success');
    loadApiKeys();
  } else {
    showNotification('Failed to delete API Key', 'error');
  }
}

// ---- Knowledge: Upload Docs ----
async function loadDocuments() {
  const res = await fetch(API_BASE + '/documents', { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  const list = document.getElementById('document-list');
  list.innerHTML = '';
  
  if (data.documents.length === 0) {
    list.innerHTML = '<div style="color: var(--text-muted); font-size: 14px; font-style: italic; text-align: center; padding: 20px;">No documents uploaded yet.</div>';
    return;
  }

  data.documents.forEach((doc, index) => {
    const div = document.createElement('div');
    div.className = 'doc-item';
    
    const isPdf = doc.file_type === 'application/pdf' || doc.filename.toLowerCase().endsWith('.pdf');
    const docType = isPdf ? 'PDF' : 'TXT';
    
    div.innerHTML = `
      <div class="doc-info">
        <span class="doc-icon" style="background:${isPdf ? 'rgba(239,68,68,0.15)' : 'rgba(113,113,122,0.2)'}; color:${isPdf ? '#f87171' : '#a1a1aa'}; font-size:10px; font-weight:700;">${docType}</span>
        <div class="doc-meta">
          <span class="doc-name" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</span>
          <span class="doc-date">${new Date(doc.created_at).toLocaleString()}</span>
        </div>
      </div>
      <button class="delete-doc-btn" title="Delete Document" aria-label="Delete Document">
        DEL
      </button>
    `;

    div.querySelector('.delete-doc-btn').addEventListener('click', () => {
      deleteDocument(doc.id, div);
    });

    list.appendChild(div);

    // Stagger animation for document items
    animate(div, { opacity: [0, 1], y: [15, 0] }, { 
      duration: 0.3, 
      delay: index * 0.05 
    });
  });
}

async function deleteDocument(id, element) {
  if (!await showConfirm('Are you sure you want to delete this document? This will remove all associated chunk data and embeddings.', 'Delete Document')) return;
  try {
    const res = await fetch(API_BASE + `/documents/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      animate(element, { opacity: 0, scale: 0.9, height: 0, marginBottom: 0, padding: 0 }, { duration: 0.3 }).then(() => {
        loadDocuments();
      });
    } else {
      const data = await res.json();
      showNotification('Error: ' + data.error, 'error');
    }
  } catch (e) {
    showNotification('Error deleting document', 'error');
  }
}

// ---- Drag and drop zone setup ----
function initUploadZone() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-upload');

  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove('drag-over');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length) {
      selectedFile = files[0];
      try {
        const myDt = new DataTransfer();
        myDt.items.add(selectedFile);
        fileInput.files = myDt.files;
      } catch (err) {
        console.error('Failed to sync to file input:', err);
      }
      handleFileSelected();
    }
  });

  fileInput.addEventListener('change', handleFileSelected);
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function handleFileSelected() {
  const fileInput = document.getElementById('file-upload');
  const container = document.getElementById('selected-file-container');
  const nameEl = document.getElementById('selected-file-name');
  const sizeEl = document.getElementById('selected-file-size');

  if (fileInput.files.length) {
    selectedFile = fileInput.files[0];
  }

  if (!selectedFile) {
    container.style.display = 'none';
    return;
  }

  nameEl.innerText = selectedFile.name;
  sizeEl.innerText = `(${formatBytes(selectedFile.size)})`;

  container.style.display = 'flex';
  animate(container, { opacity: [0, 1], y: [10, 0] }, { duration: 0.3 });
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function uploadFile() {
  const fileInput = document.getElementById('file-upload');
  const status = document.getElementById('upload-status');
  const selectedContainer = document.getElementById('selected-file-container');
  const progressContainer = document.getElementById('upload-progress-container');
  const progressFill = document.getElementById('progress-bar-fill');
  const progressPercent = document.getElementById('upload-progress-percent');
  const progressStatus = document.getElementById('upload-progress-status');
  const uploadSpinner = document.getElementById('upload-animation-spinner');

  if (!selectedFile) return;

  const file = selectedFile;
  const formData = new FormData();
  const fileSize = file.size;

  // Corrected bug: error if size is GREATER than 10MB
  if (fileSize > 10000000) {
    showNotification('File size must be less than 10MB', 'error');
    return;
  }
  formData.append('file', file);

  // Transition UI
  selectedContainer.style.display = 'none';
  progressContainer.style.display = 'flex';
  uploadSpinner.style.display = 'block';
  progressStatus.innerText = 'Uploading and processing document...';
  if (status) status.innerText = '';

  let progressAnimation = animate(progressFill, { width: ['0%', '90%'] }, { 
    duration: 3.5,
    easing: "ease-out"
  });

  let percentVal = 0;
  const percentInterval = setInterval(() => {
    if (percentVal < 90) {
      percentVal += Math.ceil((90 - percentVal) * 0.15);
      progressPercent.innerText = `${percentVal}%`;
    }
  }, 300);

  try {
    const res = await fetch(API_BASE + '/documents/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    clearInterval(percentInterval);

    if (res.ok) {
      progressAnimation.stop();
      progressPercent.innerText = '100%';
      progressStatus.innerText = 'Upload complete! Document indexed.';
      showNotification('Document uploaded and indexed successfully!', 'success');
      
      animate(progressFill, { width: '100%' }, { duration: 0.3 });
      uploadSpinner.style.display = 'none';
      progressFill.style.background = '#10b981';

      fileInput.value = '';
      selectedFile = null;
      loadDocuments();

      setTimeout(() => {
        animate(progressContainer, { opacity: 0, y: -10 }, { duration: 0.4 }).then(() => {
          progressContainer.style.display = 'none';
          progressContainer.style.opacity = '1';
          progressFill.style.width = '0%';
          progressFill.style.background = 'linear-gradient(90deg, var(--primary) 0%, #5eead4 100%)';
        });
      }, 2500);

    } else {
      const data = await res.json();
      progressStatus.innerText = 'Error: ' + data.error;
      showNotification('Error: ' + data.error, 'error');
      progressFill.style.background = '#ef4444';
      uploadSpinner.style.display = 'none';
    }
  } catch (e) {
    clearInterval(percentInterval);
    progressStatus.innerText = 'Error uploading file.';
    showNotification('Error uploading file.', 'error');
    progressFill.style.background = '#ef4444';
    uploadSpinner.style.display = 'none';
  }
}

// ---- Security Module ----
async function loadSecurityDashboard() {
  await Promise.all([
    loadSecurityStats(),
    loadSecurityLogs(),
    loadSecurityRules(),
    loadBlockedAttacks()
  ]);
}

async function loadSecurityStats() {
  try {
    const res = await fetch(API_BASE + '/security/stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    const blockedEl = document.getElementById('stat-blocked-count');
    if (blockedEl) blockedEl.innerText = data.blockedCount || 0;
    const piiEl = document.getElementById('stat-pii-count');
    if (piiEl) piiEl.innerText = data.piiCount || 0;

    // Also populate hero-strip stats if present
    const heroBlocked = document.getElementById('hero-blocked');
    if (heroBlocked) heroBlocked.innerText = data.blockedCount || 0;
    const heroPii = document.getElementById('hero-pii');
    if (heroPii) heroPii.innerText = data.piiCount || 0;
    const heroSessions = document.getElementById('hero-sessions');
    if (heroSessions && data.activeSessions) heroSessions.innerText = data.activeSessions;
    const heroApiCalls = document.getElementById('hero-api-calls');
    if (heroApiCalls && data.apiCalls24h) heroApiCalls.innerText = data.apiCalls24h;
    const heroDocuments = document.getElementById('hero-documents');
    if (heroDocuments) heroDocuments.innerText = data.documentCount || 0;
  } catch (e) {
    console.error('Failed to load security stats', e);
  }
}

async function loadSecurityLogs() {
  try {
    const res = await fetch(API_BASE + '/security/logs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    const auditContainer = document.getElementById('security-log-tbody-audit');
    if (!auditContainer) return;
    auditContainer.innerHTML = '';
    
    if (!data.logs || data.logs.length === 0) {
      auditContainer.innerHTML = `
        <div class="audit-row">
          <span class="a-time">--:--</span>
          <span class="a-tag tag-ok">OK</span>
          <span class="a-msg">No security events logged yet.</span>
        </div>
      `;
      return;
    }
    
    data.logs.forEach((log, index) => {
      const row = document.createElement('div');
      row.className = 'audit-row';
      
      const timeStr = new Date(log.created_at).toLocaleString();
      const ipStr = log.ip_address || 'N/A';
      
      let tagClass = 'tag-ok';
      let tagText = 'ALLOW';
      if (log.event_type === 'PROMPT_INJECTION') { tagClass = 'tag-block'; tagText = 'BLOCK'; }
      else if (log.event_type === 'ABUSE_RATE_LIMIT') { tagClass = 'tag-block'; tagText = 'BLOCK'; }
      else if (log.event_type === 'PII_REDACTION') { tagClass = 'tag-redact'; tagText = 'REDACT'; }
      
      row.innerHTML = `
        <span class="a-time">${timeStr}</span>
        <span class="a-tag ${tagClass}">${tagText}</span>
        <span class="a-msg">${escapeHtml(log.details || log.event_type)}</span>
      `;
      
      auditContainer.appendChild(row);
      
      animate(row, { opacity: [0, 1], x: [-10, 0] }, { 
        duration: 0.25, 
        delay: Math.min(index * 0.03, 0.6) 
      });
    });
  } catch (e) {
    console.error('Failed to load security logs', e);
  }
}

async function loadSecurityRules() {
  try {
    const res = await fetch(API_BASE + '/security/rules', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    const listEl = document.getElementById('hermes-rules-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    if (data.rules.length === 0) {
      listEl.innerHTML = `
        <div style="color: var(--text-muted); font-size: 13px; font-style: italic; text-align: center; padding: 20px;">
          No adaptive rules synthesized yet. Run auditor to generate them.
        </div>
      `;
      return;
    }
    
    data.rules.forEach((rule, index) => {
      const div = document.createElement('div');
      div.className = 'rule-item glass';
      
      const statusClass = `status-${rule.status.toLowerCase()}`;
      const timeStr = new Date(rule.created_at).toLocaleDateString();
      
      let actionButtons = '';
      if (rule.status === 'pending') {
        actionButtons = `
          <button class="rule-action-btn approve-btn" onclick="approveRule(${rule.id})" title="Approve Rule">OK</button>
          <button class="rule-action-btn reject-btn" onclick="rejectRule(${rule.id})" title="Reject Rule">NO</button>
        `;
      } else {
        actionButtons = `
          <button class="rule-action-btn delete-btn" onclick="deleteRule(${rule.id})" title="Delete Rule">DEL</button>
        `;
      }
      
      div.innerHTML = `
        <div class="rule-meta">
          <div class="rule-title-row">
            <span class="rule-name">${escapeHtml(rule.name)}</span>
            <span class="badge badge-status ${statusClass}">${rule.status}</span>
            <span class="badge severity-${rule.severity.toLowerCase()}">${rule.severity}</span>
          </div>
          <div class="rule-pattern"><code>/${escapeHtml(rule.regex_pattern)}/i</code></div>
          <div class="rule-date">Generated on ${timeStr}</div>
        </div>
        <div class="rule-actions">
          ${actionButtons}
        </div>
      `;
      
      listEl.appendChild(div);
      animate(div, { opacity: [0, 1], y: [10, 0] }, { duration: 0.25, delay: Math.min(index * 0.05, 0.5) });
    });
  } catch (e) {
    console.error('Failed to load security rules', e);
  }
}

async function approveRule(id) {
  try {
    const res = await fetch(`${API_BASE}/security/rules/${id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      loadSecurityRules();
    } else {
      const errData = await res.json();
      showNotification('Error: ' + errData.error, 'error');
    }
  } catch (e) {
    showNotification('Error approving rule', 'error');
  }
}

async function rejectRule(id) {
  try {
    const res = await fetch(`${API_BASE}/security/rules/${id}/reject`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      loadSecurityRules();
    } else {
      const errData = await res.json();
      showNotification('Error: ' + errData.error, 'error');
    }
  } catch (e) {
    showNotification('Error rejecting rule', 'error');
  }
}

async function deleteRule(id) {
  if (!await showConfirm('Are you sure you want to delete this rule?', 'Delete Rule')) return;
  try {
    const res = await fetch(`${API_BASE}/security/rules/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      loadSecurityRules();
    } else {
      const errData = await res.json();
      showNotification('Error: ' + errData.error, 'error');
    }
  } catch (e) {
    showNotification('Error deleting rule', 'error');
  }
}

async function triggerHermesAuditor() {
  const btn = document.getElementById('run-auditor-btn');
  if (!btn) return;
  
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Auditing Log...';
  btn.style.opacity = '0.7';

  try {
    const res = await fetch(API_BASE + '/security/rules/audit', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(data.message, 'success');
      loadSecurityDashboard();
    } else {
      showNotification('Audit Failed: ' + data.error, 'error');
    }
  } catch (e) {
    showNotification('Error triggering Hermes auditor', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
    btn.style.opacity = '';
  }
}

async function loadBlockedAttacks() {
  try {
    const res = await fetch(API_BASE + '/security/blocked-attacks', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    const tbody = document.getElementById('semantic-memory-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (data.attacks.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 20px;">
            No attack signatures cached in semantic memory yet.
          </td>
        </tr>
      `;
      return;
    }
    
    data.attacks.forEach((attack, index) => {
      const tr = document.createElement('tr');
      const timeStr = new Date(attack.created_at).toLocaleString();
      
      let badgeClass = 'event-injection';
      if (attack.detected_via === 'semantic_memory') badgeClass = 'event-pii';
      
      tr.innerHTML = `
        <td style="white-space: nowrap; color: var(--text-muted);">${timeStr}</td>
        <td><span class="badge ${badgeClass}">${attack.detected_via}</span></td>
        <td style="max-width: 350px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; color: var(--text-muted);" title="${escapeHtml(attack.original_prompt)}">
          ${escapeHtml(attack.original_prompt)}
        </td>
      `;
      
      tbody.appendChild(tr);
      animate(tr, { opacity: [0, 1], x: [-10, 0] }, { duration: 0.25, delay: Math.min(index * 0.03, 0.5) });
    });
  } catch (e) {
    console.error('Failed to load blocked attacks', e);
  }
}

// Expose actions to the window object for inline event listeners
window.approveRule = approveRule;
window.rejectRule = rejectRule;
window.deleteRule = deleteRule;
window.triggerHermesAuditor = triggerHermesAuditor;

// ---- Usage Logs ----
async function loadUsageLogs() {
  const list = document.getElementById('usage-log-list');
  const count = document.getElementById('usage-count');
  if (!list) return;

  try {
    const res = await fetch(API_BASE + '/usage/logs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();

    list.innerHTML = '';

    if (!data.logs || data.logs.length === 0) {
      list.innerHTML = '<div style="color: #71717a; font-size: 11px; font-family: monospace; padding: 16px 0; text-align: center;">No usage data yet. Send some messages first.</div>';
      if (count) count.innerText = '0 calls';
      return;
    }

    if (count) count.innerText = `${data.logs.length} calls`;

    data.logs.forEach((log, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 10px; padding: 7px 0; font-size: 11px; font-family: monospace; color: #a1a1aa; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03);';
      row.style.animation = `heroFadeIn 0.3s ${i * 0.03}s both ease-out`;

      const time = new Date(log.created_at).toLocaleString();
      const src = log.source === 'api' ? 'API' : 'Web';

      row.innerHTML = `
        <span style="color: #71717a; font-size: 10px;">${time}</span>
        <span style="font-weight: 600; font-size: 10px;">${src}</span>
        <span style="color: #52525b;">${(log.input_tokens || 0).toLocaleString()}</span>
        <span style="color: #52525b;">${(log.output_tokens || 0).toLocaleString()}</span>
      `;
      list.appendChild(row);
    });
  } catch (e) {
    console.error('Failed to load usage logs', e);
  }
}

let sigmaInstance = null;

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? 
    `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : 
    '45, 212, 191';
}

function applyForceLayout(graph, iterations = 75) {
  const nodes = graph.nodes();
  const edges = graph.edges();
  if (nodes.length === 0) return;

  // Initialize with circular layout
  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    graph.setNodeAttribute(node, 'x', Math.cos(angle) * 200);
    graph.setNodeAttribute(node, 'y', Math.sin(angle) * 200);
  });

  const repFactor = 160;
  const attFactor = 0.015;
  const gravity = 0.06;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = {};
    nodes.forEach(node => {
      disp[node] = { x: 0, y: 0 };
    });

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        const x1 = graph.getNodeAttribute(n1, 'x');
        const y1 = graph.getNodeAttribute(n1, 'y');
        const x2 = graph.getNodeAttribute(n2, 'x');
        const y2 = graph.getNodeAttribute(n2, 'y');

        let dx = x1 - x2;
        let dy = y1 - y2;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1.0;

        let force = (repFactor * repFactor) / dist;
        disp[n1].x += (dx / dist) * force;
        disp[n1].y += (dy / dist) * force;
        disp[n2].x -= (dx / dist) * force;
        disp[n2].y -= (dy / dist) * force;
      }
    }

    // Attraction
    edges.forEach(edge => {
      const source = graph.source(edge);
      const target = graph.target(edge);
      const x1 = graph.getNodeAttribute(source, 'x');
      const y1 = graph.getNodeAttribute(source, 'y');
      const x2 = graph.getNodeAttribute(target, 'x');
      const y2 = graph.getNodeAttribute(target, 'y');

      let dx = x1 - x2;
      let dy = y1 - y2;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1.0;

      let force = (dist * dist) / (attFactor * 1000);
      disp[source].x -= (dx / dist) * force;
      disp[source].y -= (dy / dist) * force;
      disp[target].x += (dx / dist) * force;
      disp[target].y += (dy / dist) * force;
    });

    // Apply displacements
    nodes.forEach(node => {
      const x = graph.getNodeAttribute(node, 'x');
      const y = graph.getNodeAttribute(node, 'y');

      disp[node].x -= x * gravity;
      disp[node].y -= y * gravity;

      const maxDisp = 40 / (1 + iter * 0.05);
      const dist = Math.sqrt(disp[node].x * disp[node].x + disp[node].y * disp[node].y) || 1.0;
      const step = Math.min(dist, maxDisp);

      graph.setNodeAttribute(node, 'x', x + (disp[node].x / dist) * step);
      graph.setNodeAttribute(node, 'y', y + (disp[node].y / dist) * step);
    });
  }
}

async function loadGraphData() {
  const container = document.getElementById('graph-canvas');
  const emptyEl = document.getElementById('graph-empty');
  const statusEl = document.getElementById('graph-status');
  
  if (!container) return;
  
  if (statusEl) statusEl.innerText = "Loading knowledge graph...";
  
  try {
    const res = await fetch(API_BASE + '/documents/graph', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) throw new Error("Failed to fetch graph data");
    
    const data = await res.json();
    
    if (!data.nodes || data.nodes.length === 0) {
      if (emptyEl) emptyEl.style.display = 'flex';
      container.style.display = 'none';
      closeGraphDetails();
      if (statusEl) statusEl.innerText = "No graph data found.";
      return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    container.style.display = 'block';
    
    // Create graphology graph instance
    const graph = new graphology.Graph();
    
    // Pre-calculate degrees for node sizing
    const degrees = {};
    data.edges.forEach(edge => {
      degrees[edge.source] = (degrees[edge.source] || 0) + 1;
      degrees[edge.target] = (degrees[edge.target] || 0) + 1;
    });
    
    // Add nodes to graphology
    data.nodes.forEach(node => {
      let color = '#2dd4bf'; // Teal default
      if (node.type === 'ORGANIZATION') color = '#38bdf8'; // Blue
      else if (node.type === 'PERSON') color = '#a78bfa'; // Purple
      else if (node.type === 'EVENT') color = '#f43f5e'; // Rose
      else if (node.type === 'LOCATION') color = '#fb923c'; // Orange
      
      const deg = degrees[node.id] || 0;
      const size = 6 + Math.sqrt(deg) * 4;
      
      graph.addNode(node.id, {
        label: node.label,
        entityType: node.type,
        description: node.description,
        size: size,
        color: color
      });
    });
    
    // Add edges to graphology
    data.edges.forEach((edge, i) => {
      // Ensure endpoints exist in graphology
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        graph.addEdgeWithKey(`edge-${i}`, edge.source, edge.target, {
          weight: edge.weight,
          description: edge.description,
          color: "rgba(255, 255, 255, 0.15)",
          size: Math.min(edge.weight || 1, 3)
        });
      }
    });
    
    // Position nodes using force-directed layout
    applyForceLayout(graph);
    
    // Setup Sigma.js rendering
    if (sigmaInstance) {
      sigmaInstance.kill();
      sigmaInstance = null;
    }
    
    // Setup Hover and Highlighting State
    let hoveredNode = null;
    let hoveredNeighbors = new Set();
    
    sigmaInstance = new Sigma(graph, container, {
      defaultNodeColor: "#2dd4bf",
      defaultEdgeColor: "rgba(255, 255, 255, 0.15)",
      labelColor: { color: "#e2e8f0" },
      labelSize: 11,
      labelFont: "Inter, sans-serif",
      labelWeight: "500",
      nodeReducer: (node, data) => {
        const res = { ...data };
        if (hoveredNode) {
          if (node === hoveredNode) {
            res.highlighted = true;
          } else if (hoveredNeighbors.has(node)) {
            res.highlighted = false;
          } else {
            res.label = "";
            res.color = "rgba(100, 116, 139, 0.15)";
          }
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const res = { ...data };
        if (hoveredNode) {
          if (graph.source(edge) === hoveredNode || graph.target(edge) === hoveredNode) {
            res.color = "rgba(45, 212, 191, 0.8)";
            res.size = 2;
          } else {
            res.color = "rgba(255, 255, 255, 0.02)";
          }
        }
        return res;
      }
    });
    
    // Bind Event Listeners
    sigmaInstance.on("enterNode", ({ node }) => {
      hoveredNode = node;
      hoveredNeighbors = new Set(graph.neighbors(node));
      sigmaInstance.refresh();
    });
    
    sigmaInstance.on("leaveNode", () => {
      hoveredNode = null;
      hoveredNeighbors.clear();
      sigmaInstance.refresh();
    });
    
    function selectNode(nodeId) {
      const nodeData = data.nodes.find(n => n.id === nodeId);
      if (!nodeData) return;
      
      const panel = document.getElementById('graph-details-panel');
      const titleEl = document.getElementById('graph-detail-title');
      const typeEl = document.getElementById('graph-detail-type');
      const descEl = document.getElementById('graph-detail-desc');
      const relationsList = document.getElementById('graph-detail-relations-list');
      
      if (titleEl) titleEl.innerText = nodeData.label;
      if (typeEl) {
        typeEl.innerText = nodeData.type;
        let color = '#2dd4bf';
        if (nodeData.type === 'ORGANIZATION') color = '#38bdf8';
        else if (nodeData.type === 'PERSON') color = '#a78bfa';
        else if (nodeData.type === 'EVENT') color = '#f43f5e';
        else if (nodeData.type === 'LOCATION') color = '#fb923c';
        
        typeEl.style.background = `rgba(${hexToRgb(color)}, 0.15)`;
        typeEl.style.color = color;
        typeEl.style.borderColor = `rgba(${hexToRgb(color)}, 0.3)`;
      }
      if (descEl) descEl.innerText = nodeData.description || 'No description available.';
      
      if (relationsList) {
        relationsList.innerHTML = '';
        const neighbors = graph.neighbors(nodeId);
        if (neighbors.length === 0) {
          relationsList.innerHTML = '<li style="color: #71717a; font-style: italic; padding: 4px 0;">No connections</li>';
        } else {
          neighbors.forEach(neigh => {
            const neighData = data.nodes.find(n => n.id === neigh);
            const li = document.createElement('li');
            li.style.cssText = 'padding: 6px 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: all 0.2s;';
            li.innerHTML = `
              <span style="font-weight: 500; color: #e2e8f0;">${neigh}</span>
              <span style="font-size: 10px; color: #71717a; font-family: monospace;">${neighData ? neighData.type : 'ENTITY'}</span>
            `;
            li.addEventListener('mouseover', () => {
              li.style.borderColor = '#2dd4bf';
              li.style.background = 'rgba(45, 212, 191, 0.05)';
            });
            li.addEventListener('mouseout', () => {
              li.style.borderColor = 'rgba(255,255,255,0.05)';
              li.style.background = 'rgba(255,255,255,0.02)';
            });
            li.addEventListener('click', (e) => {
              e.stopPropagation();
              const camera = sigmaInstance.getCamera();
              camera.animate({
                x: graph.getNodeAttribute(neigh, 'x'),
                y: graph.getNodeAttribute(neigh, 'y'),
                ratio: camera.getState().ratio
              }, { duration: 500 });
              selectNode(neigh);
            });
            relationsList.appendChild(li);
          });
        }
      }
      
      if (panel) panel.style.display = 'flex';
    }
    
    sigmaInstance.on("clickNode", ({ node }) => {
      selectNode(node);
    });
    
    sigmaInstance.on("clickStage", () => {
      closeGraphDetails();
    });
    
    if (statusEl) statusEl.innerText = `Graph loaded successfully (${data.nodes.length} nodes, ${data.edges.length} edges).`;
    
  } catch (err) {
    console.error("Error rendering knowledge graph:", err);
    if (statusEl) statusEl.innerText = "Error loading knowledge graph.";
    showNotification("Failed to load knowledge graph: " + err.message, "error");
  }
}

function closeGraphDetails() {
  const panel = document.getElementById('graph-details-panel');
  if (panel) panel.style.display = 'none';
}

function zoomGraph(factor) {
  if (!sigmaInstance) return;
  const camera = sigmaInstance.getCamera();
  const ratio = camera.getState().ratio;
  camera.animate({ ratio: ratio / factor }, { duration: 250 });
}

function resetGraphView() {
  if (!sigmaInstance) return;
  sigmaInstance.getCamera().animate({ x: 0, y: 0, ratio: 1.0 }, { duration: 300 });
}

window.closeGraphDetails = closeGraphDetails;
window.zoomGraph = zoomGraph;
window.resetGraphView = resetGraphView;
window.loadGraphData = loadGraphData;

async function resetVectorDB() {
  if (!await showConfirm('Are you sure you want to reset the vector database? This will clear all existing document embeddings.', 'Reset Vector DB')) return;
  
  const statusEl = document.getElementById('db-status');
  if (statusEl) statusEl.innerText = 'Resetting...';
  
  try {
    const res = await fetch(API_BASE + '/settings/reset-vdb', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(data.message, 'success');
      if (statusEl) statusEl.innerText = 'Reset successful.';
    } else {
      showNotification('Reset Failed: ' + data.detail, 'error');
      if (statusEl) statusEl.innerText = 'Reset failed.';
    }
  } catch (e) {
    showNotification('Error resetting vector database', 'error');
    if (statusEl) statusEl.innerText = 'Error.';
  }
}

window.resetVectorDB = resetVectorDB;

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('[PWA] Service Worker registered successfully with scope:', reg.scope);
      })
      .catch(err => {
        console.error('[PWA] Service Worker registration failed:', err);
      });
  });
}


