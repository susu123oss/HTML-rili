const apiBase = '/api';
const colors = ['#4361ee', '#3a0ca3', '#4cc9f0', '#4CAF50', '#ff9800', '#f44336', '#9c27b0', '#00bcd4', '#795548', '#607d8b'];
const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

const jobTitles = [
  '结构工程师',
  '助理结构工程师',
  '电气工程师',
  '助理电气工程师',
  '测试工程师',
  '技术员',
  '储备干部'
];
const savedLoginKey = 'calendarSavedLogin';

const state = {
  token: localStorage.getItem('calendarToken') || '',
  user: null,
  users: [],
  memos: [],
  reminders: [],
  reminderError: '',
  reminderRequestVersion: 0,
  reminderAutoCloseTimer: null,
  reminderFilter: 'all',
  selectedReminderIds: new Set(),
  engineerNotifications: [],
  memoEtag: '',
  memoRangeKey: '',
  sessionVersion: 0,
  memoRequestVersion: 0,
  memoDetailRequestVersion: 0,
  initialLoadSessionVersion: null,
  memoRequestController: null,
  currentDate: new Date(),
  monthsToShow: Number(localStorage.getItem('calendarMonthCount') || (typeof window !== 'undefined' && window.innerWidth <= 768 ? 1 : 2)),
  selectedUserId: 'all',
  calendarStatusFilter: 'all',
  selectedMemoId: null,
  dailyDetailDate: new Date(),
  selectedAgendaDate: '',
  themePreference: localStorage.getItem('appThemePreference') || 'system',
  themeMode: 'light',
  selectedMemoColor: colors[0],
  selectedTaskColor: colors[0],
  taskAssigneeMode: 'multi',
  taskAssigneeIds: [],
  excelSelectedUserIds: null,
  activeView: 'calendar',
  opsStatus: null,
  realtimeRefreshTimer: null,
  realtimeRefreshBusy: false,
  detailDraftFromQuickAdd: false,
  memoSaveBusy: false,
  taskPublishBusy: false,
  weeklyMemos: [],
  weeklySummaries: [],
  weeklyDataRangeKey: '',
  weeklyDataLoadingKey: '',
  weeklyDataErrorKey: '',
  weeklyDataError: '',
  weeklyRequestVersion: 0,
  weeklyRequestController: null,
  weeklyPlanView: 'personal',
  weeklyMobileDay: null,
  weeklySummaryDrafts: {}
};

const $ = (id) => document.getElementById(id);
const pad = (value) => String(value).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monthKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const roleName = (role) => ({ admin: '管理员', staff: '普通员工' }[role] || '普通员工');
const editableRoles = ['staff'];
const displayUserRole = (user) => user?.jobTitle || roleName(user?.role);
const canManageWorkspace = () => state.user?.role === 'admin';
const setElementVisible = (id, visible) => {
  const element = $(id);
  if (!element) return;
  element.hidden = !visible;
  element.style.display = visible ? '' : 'none';
};
const dialogFocusOrigins = new WeakMap();
const dialogOrder = [];
const dialogFocusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function showDialog(id, focusId) {
  const dialog = $(id);
  if (!dialog) return;
  if (!dialog.classList.contains('active')) {
    dialogFocusOrigins.set(dialog, document.activeElement);
    dialogOrder.push(id);
    dialog.classList.add('active');
    window.requestAnimationFrame(() => {
      if (!dialog.classList.contains('active')) return;
      const target = (focusId && $(focusId)) || dialog.querySelector(dialogFocusable);
      try {
        target?.focus({ preventScroll: true });
      } catch (e) {
        target?.focus();
      }
    });
  }
}

function waitForWorkspaceStyles() {
  return Promise.all(['tablerStylesheet', 'themeStylesheet'].map((id) => new Promise((resolve) => {
    const link = $(id);
    if (!link || link.dataset.ready || link.sheet) return resolve();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2500);
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
  })));
}

function hideDialog(id) {
  const dialog = $(id);
  if (!dialog?.classList.contains('active')) return;
  dialog.classList.remove('active');
  const index = dialogOrder.lastIndexOf(id);
  if (index !== -1) dialogOrder.splice(index, 1);
  const origin = dialogFocusOrigins.get(dialog);
  dialogFocusOrigins.delete(dialog);
  // 若仍有父级弹窗处于开启状态，回退聚焦到父级弹窗内元素；若无弹窗，绝不可强行聚焦顶部工具栏按钮导致页面跳滚到最顶部
  const fallback = dialogOrder.length ? $(dialogOrder[dialogOrder.length - 1])?.querySelector(dialogFocusable) : null;
  window.requestAnimationFrame(() => {
    const target = origin?.isConnected ? origin : fallback;
    if (target && typeof target.focus === 'function') {
      try {
        target.focus({ preventScroll: true });
      } catch (e) {
        // 部分旧浏览器不支持 preventScroll，避免报错
      }
    }
  });
}

function handleDialogKeydown(event) {
  const id = dialogOrder[dialogOrder.length - 1];
  const dialog = id && $(id);
  if (!dialog?.classList.contains('active')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    ({ memoModal: closeMemoModal, functionsModal: closeFunctionsModal,
      dailyDetailModal: closeDailyDetailModal, reminderModal: closeReminderModal, weeklyPlanModal: closeWeeklyPlanModal })[id]?.();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll(dialogFocusable)].filter((element) => element.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function setOperationFeedback(id, message) {
  const box = $(id);
  if (!box) {
    if (message) alert(message);
    return;
  }
  box.textContent = message;
  box.hidden = !message;
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const randomMemoColor = (excludedColor = '') => {
  const candidates = colors.length > 1 ? colors.filter((color) => color !== excludedColor) : colors;
  return candidates[Math.floor(Math.random() * candidates.length)] || colors[0];
};
const optionHtml = (value, label, selectedValue) => `<option value="${escapeHtml(value)}" ${String(value) === String(selectedValue) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`;
};
const formatDuration = (seconds) => {
  const total = Math.max(0, Number(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}天 ${hours}小时`;
  if (hours) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
};
const opsLevelText = (level) => ({ normal: '正常', warning: '注意', danger: '风险' }[level] || '未知');
const opsLevelClass = (level) => `ops-level-badge ops-level-${level || 'normal'}`;

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${apiBase}${path}`, { cache: 'no-store', ...options, headers });
  if (response.status === 304) return { notModified: true, etag: response.headers.get('etag') || '' };
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = data.message || (
      response.status === 502 ? '服务网关异常(502)' :
      response.status === 504 ? '网络请求超时(504)' :
      response.status === 403 ? '没有权限执行此操作(403)' :
      response.status === 404 ? '请求的内容不存在(404)' :
      '网络请求失败'
    );
    throw new Error(errorMsg);
  }
  return { ...data, etag: response.headers.get('etag') || data.etag || '' };
}

function readSavedLogin() {
  try {
    return JSON.parse(localStorage.getItem(savedLoginKey) || '{}');
  } catch (error) {
    return {};
  }
}

function updateSavedLogin(username, password) {
  if ($('serverRememberLogin')?.checked) {
    localStorage.setItem(savedLoginKey, JSON.stringify({ username, password }));
    return;
  }
  localStorage.removeItem(savedLoginKey);
}

function activateAuthPanel(panel) {
  const activePanel = panel === 'register' || panel === 'password' ? panel : 'login';
  $('serverLoginPanel')?.classList.toggle('active', activePanel === 'login');
  $('serverRegisterPanel')?.classList.toggle('active', activePanel === 'register');
  $('serverPasswordPanel')?.classList.toggle('active', activePanel === 'password');
  $('serverLoginTab')?.classList.toggle('active', activePanel === 'login');
  $('serverRegisterTab')?.classList.toggle('active', activePanel === 'register');
  $('serverPasswordTab')?.classList.toggle('active', activePanel === 'password');
  if ($('serverLoginError')) {
    $('serverLoginError').textContent = '';
    $('serverLoginError').style.display = 'none';
  }
  const title = $('serverAuthTitle');
  const subtitle = $('serverAuthSubtitle');
  if (title && subtitle) {
    if (activePanel === 'login') {
      title.textContent = '欢迎回来';
      subtitle.textContent = '请登录您的工作账号，查看排期与备忘录';
    } else if (activePanel === 'register') {
      title.textContent = '新成员注册';
      subtitle.textContent = '填写基本信息，加入研发部团队工作日历';
    } else if (activePanel === 'password') {
      title.textContent = '安全中心';
      subtitle.textContent = '定期更换密码，保障个人工作备忘数据安全';
    }
  }
}

function setupPasswordEyeToggle(inputId, eyeBtnId) {
  const input = $(inputId);
  const btn = $(eyeBtnId);
  if (!input || !btn) return;
  btn.addEventListener('click', () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.textContent = isPassword ? '🙈' : '👁️';
  });
}

function showLoginOverlay(message = '') {
  let overlay = $('serverLoginOverlay');
  if (!overlay) {
    const savedLogin = readSavedLogin();
    overlay = document.createElement('div');
    overlay.id = 'serverLoginOverlay';
    overlay.innerHTML = `
      <div class="login-corner-bar">
        <button type="button" class="login-theme-toggle" id="loginThemeToggle" title="切换模式：浅色 / 深色 / 跟随系统">
          <i class="${themeToggleIconClass(state.themePreference, state.themeMode)}"></i>
          <span class="login-theme-label">${themeToggleLabelText(state.themePreference)}</span>
        </button>
      </div>

      <div class="server-login-container">
        <!-- 左侧：品牌与特性展示区 -->
        <div class="server-login-brand">
          <div class="server-brand-top">
            <div class="server-brand-logo-row">
              <div class="server-brand-logo-icon">📅</div>
              <div>
                <div class="server-brand-title-wrap">
                  <span class="server-brand-app-name">智能工作日历</span>
                  <span class="server-brand-badge">Server</span>
                </div>
                <div class="server-brand-dept">团队协作与研发工作台</div>
              </div>
            </div>
            
            <div class="server-brand-hero">
              <div class="server-status-pill">
                <span class="server-status-dot"></span>
                研发服务器已就绪
              </div>
              <h2 class="server-brand-heading">清晰可视每一个研发排期与备忘</h2>
              <p class="server-brand-desc">告别单机本地存储风险，团队任务同步流转、多月份全景穿透、研发进度大屏尽在掌握。</p>
            </div>
          </div>

          <!-- 中部微型卡片预览 -->
          <div class="server-brand-preview-card">
            <div class="server-preview-head">
              <span class="server-preview-title"><span class="server-preview-indicator"></span>9月研发重点跟进</span>
              <span class="server-preview-tag">进行中</span>
            </div>
            <div class="server-preview-list">
              <div class="server-preview-row"><span>✓ SolidWorks 零件结构优化</span><span class="server-preview-sub">已完成</span></div>
              <div class="server-preview-row"><span>⏳ PCB 驱动电路耐压测试</span><span class="server-preview-alert">今日截止</span></div>
            </div>
            <div class="server-preview-foot">
              <span>研发团队完成率</span>
              <strong>78.5%</strong>
            </div>
          </div>

          <!-- 底部保障声明 -->
          <div class="server-brand-footer">
            <span>PostgreSQL 集中化持久存储</span>
            <span>企业级加密保护</span>
          </div>
        </div>

        <!-- 右侧：表单操作区 -->
        <div class="server-login-form-area">
          <div class="server-form-header">
            <span class="server-form-ver">智能网页工作日历备忘录 · v2.0</span>
            <span class="server-online-badge"><span class="server-online-dot"></span>在线 (8090)</span>
          </div>

          <div class="server-form-wrapper">
            <div class="server-auth-header-text">
              <h2 id="serverAuthTitle">欢迎回来</h2>
              <p id="serverAuthSubtitle">请登录您的工作账号，查看排期与备忘录</p>
            </div>

            <div class="server-auth-tabs">
              <button class="active" id="serverLoginTab" type="button">账号登录</button>
              <button id="serverRegisterTab" type="button">新成员注册</button>
              <button id="serverPasswordTab" type="button">修改密码</button>
            </div>

            <!-- 1. 登录面板 -->
            <div class="server-auth-panel active" id="serverLoginPanel">
              <div class="server-form-field">
                <label>用户名 / 真实姓名</label>
                <div class="server-input-box">
                  <span class="server-input-icon">👤</span>
                  <input id="serverLoginUser" value="${escapeHtml(savedLogin.username || '')}" autocomplete="username" placeholder="请输入您的姓名或工号">
                </div>
              </div>

              <div class="server-form-field">
                <div class="server-label-row">
                  <label>登录密码</label>
                  <button type="button" class="server-link-btn" id="serverForgotPwd">忘记密码?</button>
                </div>
                <div class="server-input-box">
                  <span class="server-input-icon">🔒</span>
                  <input id="serverLoginPass" value="${escapeHtml(savedLogin.password || '')}" type="password" autocomplete="current-password" placeholder="请输入密码">
                  <button type="button" class="server-eye-btn" id="serverLoginPassEye" title="显示/隐藏密码">👁️</button>
                </div>
              </div>

              <label class="server-remember-row">
                <input id="serverRememberLogin" type="checkbox" ${savedLogin.username ? 'checked' : ''}>
                <span>在此设备上保存账号密码</span>
              </label>

              <button id="serverLoginButton" type="button">登 录 工 作 台</button>
            </div>

            <!-- 2. 注册面板 -->
            <div class="server-auth-panel" id="serverRegisterPanel">
              <div class="server-form-field">
                <label>真实姓名 <span class="req-star">*</span></label>
                <div class="server-input-box">
                  <span class="server-input-icon">👤</span>
                  <input id="serverRegisterName" autocomplete="name" placeholder="请输入真实姓名，例如：张伟">
                </div>
              </div>

              <div class="server-form-field">
                <label>初始密码 (至少 4 位) <span class="req-star">*</span></label>
                <div class="server-input-box">
                  <span class="server-input-icon">🔒</span>
                  <input id="serverRegisterPass" type="password" autocomplete="new-password" placeholder="至少 4 位">
                  <button type="button" class="server-eye-btn" id="serverRegisterPassEye" title="显示/隐藏密码">👁️</button>
                </div>
              </div>

              <div class="server-form-field">
                <label>所属岗位 <span class="req-star">*</span></label>
                <div class="server-select-box">
                  <select id="serverRegisterRole">
                    ${jobTitles.map((title) => `<option value="${escapeHtml(title)}">${escapeHtml(title)}</option>`).join('')}
                  </select>
                </div>
                <div class="server-hint-text">💡 注册后默认归入“研发部”，拥有个人独立日历权限。</div>
              </div>

              <button id="serverRegisterButton" type="button" class="btn-register-action">注册并进入工作台</button>
            </div>

            <!-- 3. 修改密码面板 -->
            <div class="server-auth-panel" id="serverPasswordPanel">
              <div class="server-form-field">
                <label>用户名 / 真实姓名</label>
                <div class="server-input-box">
                  <span class="server-input-icon">👤</span>
                  <input id="serverPasswordUser" autocomplete="username" placeholder="请输入用户名">
                </div>
              </div>

              <div class="server-form-field">
                <label>原密码</label>
                <div class="server-input-box">
                  <span class="server-input-icon">🔒</span>
                  <input id="serverOldPassword" type="password" autocomplete="current-password" placeholder="请输入原密码">
                </div>
              </div>

              <div class="server-form-field">
                <label>新密码 (至少 4 位)</label>
                <div class="server-input-box">
                  <span class="server-input-icon">🔑</span>
                  <input id="serverNewPassword" type="password" autocomplete="new-password" placeholder="至少 4 位新密码">
                  <button type="button" class="server-eye-btn" id="serverNewPasswordEye" title="显示/隐藏密码">👁️</button>
                </div>
              </div>

              <div class="server-form-field">
                <label>确认新密码</label>
                <div class="server-input-box">
                  <span class="server-input-icon">🔑</span>
                  <input id="serverConfirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码">
                </div>
              </div>

              <button id="serverChangePasswordButton" type="button">确认修改密码</button>
            </div>

            <div id="serverLoginError" class="server-login-error"></div>
          </div>

          <div class="server-form-footer">
            <span>© 2026 智能工作日历备忘录系统</span>
            <span>建议使用 Chrome / Edge 访问</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    $('serverLoginButton').addEventListener('click', login);
    $('serverRegisterButton').addEventListener('click', registerAccount);
    $('serverChangePasswordButton').addEventListener('click', changePasswordFromLogin);
    $('serverLoginTab').addEventListener('click', () => activateAuthPanel('login'));
    $('serverRegisterTab').addEventListener('click', () => activateAuthPanel('register'));
    $('serverPasswordTab').addEventListener('click', () => activateAuthPanel('password'));
    $('serverForgotPwd')?.addEventListener('click', () => activateAuthPanel('password'));
    $('serverLoginPass').addEventListener('keydown', (event) => { if (event.key === 'Enter') login(); });
    $('serverRegisterPass').addEventListener('keydown', (event) => { if (event.key === 'Enter') registerAccount(); });
    $('serverConfirmPassword').addEventListener('keydown', (event) => { if (event.key === 'Enter') changePasswordFromLogin(); });

    setupPasswordEyeToggle('serverLoginPass', 'serverLoginPassEye');
    setupPasswordEyeToggle('serverRegisterPass', 'serverRegisterPassEye');
    setupPasswordEyeToggle('serverNewPassword', 'serverNewPasswordEye');
  }
  if ($('serverLoginError')) {
    $('serverLoginError').textContent = message;
    $('serverLoginError').style.display = message ? 'block' : 'none';
  }
  overlay.style.display = 'flex';
  const sessionOverlay = $('serverSessionOverlay');
  if (sessionOverlay) {
    sessionOverlay.style.display = 'none';
    sessionOverlay.removeAttribute('data-early');
  }
}

function hideLoginOverlay() {
  const overlay = $('serverLoginOverlay');
  if (overlay) overlay.style.display = 'none';
}

let sessionProgressValue = 0;
let sessionProgressTimer = null;

function ensureSessionOverlay() {
  let overlay = $('serverSessionOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'serverSessionOverlay';
    overlay.innerHTML = `
    <div class="server-session-card" role="status" aria-live="polite">
      <div class="server-session-spinner-wrap" id="serverSessionSpinnerWrap">
        <div class="server-session-spinner" id="serverSessionSpinner" aria-hidden="true"></div>
        <div class="server-session-percent" id="serverSessionPercent">···</div>
      </div>
      <h2 id="serverSessionTitle">正在加载日历</h2>
      <div class="server-session-progress" id="serverSessionProgress" aria-hidden="true">
        <div class="server-session-progress-fill" id="serverSessionProgressFill" style="width: 0%;"></div>
      </div>
      <p id="serverSessionMessage">正在读取日历数据，请稍候…</p>
      <div class="server-session-actions">
        <button id="serverSessionRetry" type="button" hidden>重新加载日历</button>
        <button id="serverSessionLogout" type="button" hidden>退出登录</button>
      </div>
    </div>
    `;
    document.body.appendChild(overlay);
  }
  if (!overlay.dataset.bound) {
    $('serverSessionRetry')?.addEventListener('click', retryAppStart);
    $('serverSessionLogout')?.addEventListener('click', logout);
    overlay.dataset.bound = 'true';
  }
  return overlay;
}

function resetSessionProgress() {
  if (sessionProgressTimer) {
    clearInterval(sessionProgressTimer);
    sessionProgressTimer = null;
  }
  sessionProgressValue = 0;
  $('serverSessionOverlay')?.setAttribute('data-loading', '');
  const percentEl = $('serverSessionPercent');
  const fillEl = $('serverSessionProgressFill');
  const msgEl = $('serverSessionMessage');
  if (fillEl) {
    // 禁用过渡动画瞬间归零，强制重绘，杜绝任何“从100%往回滑退”的倒退视觉
    fillEl.style.transition = 'none';
    fillEl.style.width = '0%';
    void fillEl.offsetWidth; // 触发 reflow
    fillEl.style.transition = '';
  }
  if (percentEl) percentEl.textContent = '···';
  if (msgEl) msgEl.textContent = '正在准备工作台…';
}

function updateSessionProgress(targetPercent = 0, message = '') {
  const clamped = Math.max(0, Math.min(100, Math.round(targetPercent)));
  const percentEl = $('serverSessionPercent');
  const fillEl = $('serverSessionProgressFill');
  const msgEl = $('serverSessionMessage');
  const progEl = $('serverSessionProgress');
  const spinnerWrap = $('serverSessionSpinnerWrap');

  if (progEl) progEl.hidden = false;
  if (spinnerWrap) spinnerWrap.hidden = false;

  if (message && msgEl) {
    msgEl.textContent = message;
  }

  if (clamped > 0) $('serverSessionOverlay')?.removeAttribute('data-loading');

  // 单调递增保护：加载流程中进度条只能向前走，绝不允许倒退！
  if (clamped < sessionProgressValue && targetPercent !== 0) {
    return;
  }

  if (sessionProgressTimer) {
    clearInterval(sessionProgressTimer);
    sessionProgressTimer = null;
  }

  const start = sessionProgressValue;
  const delta = clamped - start;
  if (delta === 0) {
    if (percentEl) percentEl.textContent = `${clamped}%`;
    if (fillEl) fillEl.style.width = `${clamped}%`;
    return;
  }

  // 进度条宽度由 CSS transition 负责单向平滑向前推
  if (fillEl) fillEl.style.width = `${clamped}%`;

  // 数字百分比由轻量定时器平滑递增
  const steps = 8;
  let currentStep = 0;
  sessionProgressTimer = setInterval(() => {
    currentStep++;
    const factor = currentStep / steps;
    const val = Math.round(start + delta * factor);
    sessionProgressValue = val;
    if (percentEl) percentEl.textContent = `${val}%`;
    if (currentStep >= steps) {
      clearInterval(sessionProgressTimer);
      sessionProgressTimer = null;
      sessionProgressValue = clamped;
      if (percentEl) percentEl.textContent = `${clamped}%`;
    }
  }, 20);
}

function showSessionOverlay(message = '正在读取日历数据，请稍候…', { error = false, percent = null } = {}) {
  const overlay = ensureSessionOverlay();
  const title = $('serverSessionTitle');
  const spinnerWrap = $('serverSessionSpinnerWrap');
  const progress = $('serverSessionProgress');
  const retryBtn = $('serverSessionRetry');
  const logoutBtn = $('serverSessionLogout');
  const msgEl = $('serverSessionMessage');

  if (title) title.textContent = error ? '日历加载失败' : '正在加载日历';
  if (msgEl) msgEl.textContent = message;

  if (spinnerWrap) spinnerWrap.hidden = error;
  if (progress) progress.hidden = error;
  if (retryBtn) retryBtn.hidden = !error;
  if (logoutBtn) logoutBtn.hidden = !error;

  if (!error) {
    const isNewOpen = overlay.style.display !== 'flex';
    if (isNewOpen) {
      resetSessionProgress();
    }
    const target = typeof percent === 'number' ? percent : Math.max(sessionProgressValue, 12);
    updateSessionProgress(target, message);
  }

  overlay.style.display = 'flex';
  if (!['tablerStylesheet', 'themeStylesheet'].every((id) => $(id)?.dataset.ready)) {
    overlay.setAttribute('data-early', '');
  }
}

function hideSessionOverlay() {
  const overlay = $('serverSessionOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.removeAttribute('data-early');
  }
  resetSessionProgress();
}

/* ========================================================
   现代定制化下拉选择器逻辑 (Custom Modern SaaS Dropdowns)
   ======================================================== */
function closeAllCustomDropdowns() {
  document.querySelectorAll('.custom-dropdown').forEach((dropdown) => {
    const btn = dropdown.querySelector('.custom-dropdown-btn');
    const menu = dropdown.querySelector('.custom-dropdown-menu');
    if (menu) menu.hidden = true;
    if (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

function renderCustomMemberOptions() {
  const memberList = $('customMemberList');
  const memberText = $('customMemberText');
  const memberBtn = $('customMemberBtn');
  if (!memberList || !memberText) return;

  const currentVal = String(state.selectedUserId || 'all');
  let selectedName = '全部成员';

  const items = [];
  if (canManageWorkspace()) {
    const isSelected = currentVal === 'all';
    if (isSelected) selectedName = '全部成员';
    items.push(`
      <div class="custom-dropdown-item ${isSelected ? 'selected' : ''}" data-value="all" role="option" aria-selected="${isSelected}">
        <div class="item-main">
          <span class="item-avatar all"><i class="fas fa-users"></i></span>
          <span class="item-name">全部成员</span>
        </div>
        <span class="item-badge">全员</span>
        ${isSelected ? '<i class="fas fa-check item-check"></i>' : ''}
      </div>
    `);
  }

  (state.users || []).forEach((user) => {
    const userId = String(user.id);
    const isSelected = currentVal === userId;
    const displayName = user.displayName || user.username || `用户${user.id}`;
    const roleText = displayUserRole(user);
    const initial = (displayName.charAt(0) || 'U').toUpperCase();

    if (isSelected) {
      selectedName = displayName;
    }

    items.push(`
      <div class="custom-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${escapeHtml(userId)}" role="option" aria-selected="${isSelected}">
        <div class="item-main">
          <span class="item-avatar">${escapeHtml(initial)}</span>
          <span class="item-name">${escapeHtml(displayName)}</span>
        </div>
        <span class="item-badge">${escapeHtml(roleText)}</span>
        ${isSelected ? '<i class="fas fa-check item-check"></i>' : ''}
      </div>
    `);
  });

  memberText.textContent = selectedName;
  if (memberBtn) {
    memberBtn.title = `切换查看人员 (当前: ${selectedName})`;
  }
  memberList.innerHTML = items.join('');

  memberList.querySelectorAll('.custom-dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      const val = item.dataset.value;
      const nativeSelect = $('serverMemberSelect');
      if (nativeSelect) {
        nativeSelect.value = val;
        nativeSelect.dispatchEvent(new Event('change'));
      } else {
        state.selectedUserId = val;
        refreshMemoViews();
        renderCustomMemberOptions();
      }
      closeAllCustomDropdowns();
    });
  });
}

function renderCustomMonthOptions() {
  const monthList = $('customMonthList');
  const monthText = $('customMonthText');
  const monthBtn = $('customMonthBtn');
  if (!monthList || !monthText) return;

  const currentVal = Number(state.monthsToShow || 2);
  monthText.textContent = `${currentVal}个月`;
  if (monthBtn) {
    monthBtn.title = `切换展示月数 (当前: ${currentVal}个月)`;
  }

  const items = [];
  for (let m = 1; m <= 12; m++) {
    const isSelected = currentVal === m;
    let tag = '';
    if (m === 2) tag = '<span class="item-tag default">默认</span>';
    else if (m === 6) tag = '<span class="item-tag">半年</span>';
    else if (m === 12) tag = '<span class="item-tag">全年</span>';

    items.push(`
      <div class="custom-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${m}" role="option" aria-selected="${isSelected}">
        <div class="item-main">
          <i class="far fa-calendar-alt item-icon"></i>
          <span class="item-name">${m}个月</span>
        </div>
        ${tag}
        ${isSelected ? '<i class="fas fa-check item-check"></i>' : ''}
      </div>
    `);
  }

  monthList.innerHTML = items.join('');

  monthList.querySelectorAll('.custom-dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      const val = item.dataset.value;
      const nativeSelect = $('monthCountSelect');
      if (nativeSelect) {
        nativeSelect.value = String(val);
        nativeSelect.dispatchEvent(new Event('change'));
      }
      closeAllCustomDropdowns();
    });
  });
}

function initCustomDropdowns() {
  const dropdownConfigs = [
    { dropdownId: 'customMemberSelect', btnId: 'customMemberBtn', menuId: 'customMemberMenu' },
    { dropdownId: 'customMonthSelect', btnId: 'customMonthBtn', menuId: 'customMonthMenu' },
  ];

  dropdownConfigs.forEach(({ dropdownId, btnId, menuId }) => {
    const dropdown = $(dropdownId);
    const btn = $(btnId);
    const menu = $(menuId);
    if (!dropdown || !btn || !menu || btn.dataset.bound) return;

    btn.dataset.bound = 'true';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      closeAllCustomDropdowns();
      if (!isExpanded) {
        menu.hidden = false;
        btn.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
      }
    });

    menu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  });

  // 点击外层标签也可呼起对应定制下拉
  $('memberSelectWrap')?.querySelector('label')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('customMemberBtn')?.click();
  });
  $('monthCountSelectorWrap')?.querySelector('label')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('customMonthBtn')?.click();
  });

  if (!document.body.dataset.dropdownOutsideBound) {
    document.body.dataset.dropdownOutsideBound = 'true';
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.custom-dropdown')) {
        closeAllCustomDropdowns();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAllCustomDropdowns();
      }
    });

    window.addEventListener('resize', () => {
      closeAllCustomDropdowns();
    }, { passive: true });
  }

  renderCustomMemberOptions();
  renderCustomMonthOptions();
}

function injectServerCss() {
  const style = document.createElement('style');
  style.textContent = `
    #serverLoginOverlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      background: #0f172a;
      padding: 24px;
      overflow-y: auto;
      box-sizing: border-box;
    }
    #serverSessionOverlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.7);
      padding: 20px;
    }
    .server-session-card {
      width: min(380px, calc(100vw - 32px));
      padding: 34px 28px;
      border-radius: 20px;
      background: var(--ui-surface, #ffffff);
      border: 1px solid var(--ui-border, rgba(0, 0, 0, 0.1));
      box-shadow: var(--ui-shadow, 0 20px 60px rgba(0, 0, 0, 0.22));
      text-align: center;
      color: var(--ui-text, #1c2024);
      display: flex;
      flex-direction: column;
      align-items: center;
      box-sizing: border-box;
    }
    .server-session-spinner-wrap {
      position: relative;
      width: 66px;
      height: 66px;
      margin: 0 auto 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .server-session-spinner {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 4px solid rgba(67, 97, 238, 0.16);
      border-top-color: var(--primary-color, #4361ee);
      border-radius: 50%;
      animation: server-session-spin 0.9s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
      box-sizing: border-box;
    }
    .server-session-percent {
      position: relative;
      z-index: 2;
      font-size: 15px;
      font-weight: 800;
      font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Monaco, Consolas, monospace;
      color: var(--primary-color, #4361ee);
      letter-spacing: -0.5px;
      user-select: none;
      line-height: 1;
    }
    .server-session-card h2 {
      margin: 14px 0 6px;
      color: var(--ui-text, #1c2024);
      font-size: 1.25rem;
      font-weight: 700;
    }
    .server-session-progress {
      width: 100%;
      height: 6px;
      background: rgba(67, 97, 238, 0.12);
      border-radius: 999px;
      overflow: hidden;
      margin: 14px 0 10px;
      box-sizing: border-box;
    }
    .server-session-progress-fill {
      height: 100%;
      width: 0%;
      border-radius: 999px;
      background: linear-gradient(90deg, #4361ee, #4cc9f0);
      transition: width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .server-session-card p {
      margin: 0;
      color: var(--ui-text-muted, #6c757d);
      font-size: 0.88rem;
      line-height: 1.6;
    }
    .server-session-actions {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 22px;
      width: 100%;
    }
    .server-session-actions button {
      padding: 10px 16px;
      border: 0;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
      color: white;
      font-weight: 700;
      cursor: pointer;
      font-size: 0.9rem;
      transition: transform 0.15s, opacity 0.15s;
    }
    .server-session-actions button:hover {
      opacity: 0.92;
      transform: translateY(-1px);
    }
    .server-session-actions button:last-child {
      background: #6c757d;
    }
    .server-session-actions button[hidden],
    .server-session-spinner-wrap[hidden],
    .server-session-spinner[hidden],
    .server-session-progress[hidden] {
      display: none;
    }
    @keyframes server-session-spin {
      to { transform: rotate(360deg); }
    }

    /* 新企业级双栏登录容器 */
    .server-login-container {
      width: min(980px, 100%);
      background: #ffffff;
      border-radius: 20px;
      box-shadow: 0 15px 40px rgba(0, 0, 0, 0.25);
      display: grid;
      grid-template-columns: 4.4fr 5.6fr;
      overflow: hidden;
      box-sizing: border-box;
      text-align: left;
    }

    /* 左侧品牌区 */
    .server-login-brand {
      background: #1e1b4b;
      color: #ffffff;
      padding: 40px 36px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      box-sizing: border-box;
    }

    .server-brand-logo-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .server-brand-logo-icon {
      width: 44px;
      height: 44px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
    }

    .server-brand-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .server-brand-app-name {
      font-size: 1.15rem;
      font-weight: 800;
      letter-spacing: -0.3px;
      color: #ffffff;
    }

    .server-brand-badge {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.35);
      border: 1px solid rgba(165, 180, 252, 0.3);
      color: #e0e7ff;
    }

    .server-brand-dept {
      font-size: 0.78rem;
      color: rgba(224, 231, 255, 0.75);
      margin-top: 2px;
    }

    .server-brand-hero {
      margin-top: 36px;
    }

    .server-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.15);
      font-size: 0.75rem;
      color: #c7d2fe;
      margin-bottom: 14px;
    }

    .server-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #34d399;
    }

    .server-brand-heading {
      font-size: 1.55rem;
      font-weight: 800;
      line-height: 1.35;
      color: #ffffff;
      margin-bottom: 12px;
      letter-spacing: -0.4px;
    }

    .server-brand-desc {
      font-size: 0.8rem;
      line-height: 1.6;
      color: rgba(224, 231, 255, 0.8);
      margin: 0;
    }

    .server-brand-preview-card {
      margin: 28px 0;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 16px;
      padding: 16px;
    }

    .server-preview-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.78rem;
      color: #c7d2fe;
      margin-bottom: 10px;
    }

    .server-preview-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }

    .server-preview-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #818cf8;
    }

    .server-preview-tag {
      font-size: 0.65rem;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(16, 185, 129, 0.2);
      color: #6ee7b7;
    }

    .server-preview-list {
      background: rgba(0, 0, 0, 0.22);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 7px;
      font-size: 0.75rem;
    }

    .server-preview-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: rgba(255, 255, 255, 0.9);
    }

    .server-preview-sub {
      font-size: 0.65rem;
      color: rgba(255, 255, 255, 0.5);
    }

    .server-preview-alert {
      font-size: 0.65rem;
      color: #fcd34d;
      font-weight: 600;
    }

    .server-preview-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.72rem;
      color: rgba(224, 231, 255, 0.8);
      margin-top: 10px;
    }

    .server-brand-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.7rem;
      color: rgba(199, 210, 254, 0.75);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 14px;
    }

    /* 右侧表单区 */
    .server-login-form-area {
      padding: 36px 42px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: #ffffff;
      box-sizing: border-box;
    }

    .server-form-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.75rem;
      color: #94a3b8;
      margin-bottom: 20px;
    }

    .server-online-badge {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #475569;
      font-weight: 500;
    }

    .server-online-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
    }

    .server-auth-header-text {
      text-align: left;
      margin-bottom: 20px;
    }

    .server-auth-header-text h2 {
      font-size: 1.5rem;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.3px;
      margin: 0 0 6px 0;
    }

    .server-auth-header-text p {
      font-size: 0.8rem;
      color: #64748b;
      margin: 0;
    }

    .server-auth-tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      background: #f1f5f9;
      border-radius: 12px;
      padding: 4px;
      margin-bottom: 22px;
    }

    .server-auth-tabs button {
      width: 100%;
      padding: 8px 4px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: #64748b;
      font-weight: 600;
      font-size: 0.78rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .server-auth-tabs button.active {
      background: #ffffff;
      color: #4338ca;
      font-weight: 700;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .server-auth-panel {
      display: none;
      text-align: left;
    }

    .server-auth-panel.active {
      display: block;
    }

    .server-form-field {
      margin-bottom: 14px;
    }

    .server-form-field label {
      display: block;
      font-size: 0.78rem;
      font-weight: 600;
      color: #334155;
      margin-bottom: 6px;
    }

    .server-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .server-link-btn {
      background: none;
      border: 0;
      padding: 0;
      color: #4f46e5;
      font-size: 0.72rem;
      cursor: pointer;
    }

    .server-link-btn:hover {
      text-decoration: underline;
    }

    .server-input-box {
      position: relative;
      display: flex;
      align-items: center;
      border: 1.5px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 10px;
      transition: all 0.18s ease;
    }

    .server-input-box:focus-within {
      border-color: #6366f1;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
    }

    .server-input-icon {
      padding-left: 12px;
      font-size: 14px;
      opacity: 0.55;
      user-select: none;
    }

    .server-input-box input {
      width: 100%;
      padding: 10px 12px 10px 10px;
      border: 0;
      background: transparent;
      font-size: 0.85rem;
      color: #0f172a;
      outline: none;
      box-sizing: border-box;
    }

    .server-eye-btn {
      padding: 0 12px;
      background: none;
      border: 0;
      cursor: pointer;
      font-size: 14px;
      opacity: 0.65;
      transition: opacity 0.15s;
    }

    .server-eye-btn:hover {
      opacity: 1;
    }

    .server-select-box select {
      width: 100%;
      padding: 10px 12px;
      border: 1.5px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 10px;
      font-size: 0.85rem;
      color: #0f172a;
      outline: none;
      box-sizing: border-box;
      transition: all 0.18s ease;
    }

    .server-select-box select:focus {
      border-color: #6366f1;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
    }

    .server-hint-text {
      font-size: 0.7rem;
      color: #64748b;
      margin-top: 6px;
      line-height: 1.4;
    }

    .req-star {
      color: #f43f5e;
    }

    .server-remember-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0 16px;
      font-size: 0.78rem;
      color: #475569;
      cursor: pointer;
    }

    .server-remember-row input {
      width: 15px;
      height: 15px;
      accent-color: #4f46e5;
      cursor: pointer;
    }

    #serverLoginButton, #serverRegisterButton, #serverChangePasswordButton {
      width: 100%;
      padding: 11px 16px;
      border: 0;
      border-radius: 11px;
      background: #4f46e5;
      color: #ffffff;
      font-weight: 700;
      font-size: 0.85rem;
      letter-spacing: 0.3px;
      cursor: pointer;
    }

    #serverLoginButton:active, #serverRegisterButton:active, #serverChangePasswordButton:active {
      opacity: 0.85;
    }

    .btn-register-action {
      background: #059669 !important;
    }

    .server-login-error {
      min-height: 20px;
      margin-top: 12px;
      font-size: 0.78rem;
      color: #e11d48;
      background: #ffe4e6;
      border: 1px solid #fecdd3;
      border-radius: 8px;
      padding: 7px 10px;
      text-align: center;
      display: none;
    }

    .server-login-error:not(:empty) {
      display: block;
    }

    .server-form-footer {
      margin-top: 20px;
      padding-top: 14px;
      border-top: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.7rem;
      color: #94a3b8;
    }

    /* ========================================================
       现代化主工作台全局顶栏 (App Topbar)
       ======================================================== */
    header.app-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 18px;
      margin-bottom: 12px;
      background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
      border-radius: var(--border-radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      color: white;
      position: relative;
      z-index: 20;
      text-align: left;
    }
    header.app-topbar::before {
      display: none;
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .app-brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .app-brand .app-logo {
      font-size: 1.4rem;
      line-height: 1;
    }
    .app-brand .app-title {
      font-size: 1.15rem;
      font-weight: 800;
      margin: 0;
      color: white;
      text-shadow: none;
      letter-spacing: -0.01em;
      white-space: nowrap;
    }
    .topbar-user-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      background: rgba(255, 255, 255, 0.18);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.95);
      white-space: nowrap;
    }
    .topbar-user-badge strong {
      color: white;
      font-weight: 700;
    }

    /* 顶部日历周期快速切换胶囊 */
    .topbar-nav {
      display: flex;
      align-items: center;
      gap: 4px;
      background: rgba(255, 255, 255, 0.22);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.32);
      padding: 3px 6px;
      border-radius: 10px;
    }
    .topbar-nav .nav-button {
      background: transparent;
      border: none;
      color: white;
      width: 30px;
      height: 30px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease;
      font-size: 0.85rem;
    }
    .topbar-nav .nav-button:hover {
      background: rgba(255, 255, 255, 0.28);
    }
    .topbar-nav .nav-button:active {
      transform: scale(0.94);
    }
    .topbar-nav .current-period {
      padding: 0 10px;
      font-weight: 700;
      font-size: 0.92rem;
      letter-spacing: 0.02em;
      white-space: nowrap;
      color: white;
      min-width: 140px;
      text-align: center;
    }
    .topbar-nav .today-btn {
      width: auto;
      padding: 0 10px;
      height: 28px;
      font-size: 0.78rem;
      font-weight: 700;
      background: white;
      color: var(--primary-color);
      border-radius: 6px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
      margin-left: 2px;
      cursor: pointer;
    }
    .topbar-nav .today-btn:hover {
      background: #f8fafc;
      color: var(--secondary-color);
    }

    /* 顶栏右侧工具区 */
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .topbar-member-selector {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      color: white;
      white-space: nowrap;
    }
    .topbar-member-selector label {
      cursor: pointer;
    }
    .topbar-member-selector select {
      padding: 5px 8px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.92);
      color: #1e293b;
      font-size: 0.82rem;
      font-weight: 600;
      outline: none;
      cursor: pointer;
    }
    .topbar-theme-toggle {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.35);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.92rem;
      cursor: pointer;
      transition: all 0.2s ease;
      flex-shrink: 0;
    }
    .topbar-theme-toggle:hover {
      background: rgba(255, 255, 255, 0.32);
    }
    .topbar-theme-toggle:active {
      transform: scale(0.92);
    }
    .login-corner-bar {
      position: absolute;
      top: 20px;
      right: 24px;
      z-index: 10001;
    }
    .login-theme-toggle {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 7px 14px;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
    }
    html[data-theme="dark"] .login-theme-toggle {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #e2e8f0;
    }
    html[data-theme="dark"] .login-theme-toggle:hover {
      background: #334155;
      color: #ffffff;
    }
    html[data-theme="light"] .login-theme-toggle {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #334155;
    }
    html[data-theme="light"] .login-theme-toggle:hover {
      background: #f1f5f9;
      color: #0f172a;
    }
    .topbar-logout-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.18);
      border: 1px solid rgba(255, 255, 255, 0.32);
      border-radius: 6px;
      color: white;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .topbar-logout-btn:hover {
      background: rgba(225, 29, 72, 0.85);
      border-color: rgba(225, 29, 72, 0.85);
    }

    /* ========================================================
       工作台二级控制栏 (Workspace Subbar)
       ======================================================== */
    .toolbar.workspace-subbar {
      margin: 0 0 16px 0 !important;
      padding: 10px 16px;
      background: white;
      border-radius: var(--border-radius);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
      border: 1px solid #eef2f6;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    .month-count-selector {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.84rem;
      color: #475569;
      white-space: nowrap;
    }
    .month-count-selector select {
      padding: 6px 10px;
      border: 1.5px solid #e2e8f0;
      border-radius: 6px;
      background: #f8fafc;
      font-size: 0.84rem;
      font-weight: 500;
      color: #334155;
      outline: none;
      cursor: pointer;
    }
    .server-disabled-note {
      padding: 10px 12px;
      border-radius: 8px;
      background: #fff8e1;
      color: #8a5a00;
      margin-bottom: 12px;
      line-height: 1.6;
    }

    /* ========================================================
       通用新增微组件与卡片基础
       ======================================================== */
    .daily-quick-add-box {
      margin-bottom: 20px;
      padding: 16px;
      border-radius: 12px;
      transition: all 0.2s ease;
    }
    .daily-quick-add-title {
      font-size: 0.95rem;
      font-weight: 700;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .daily-quick-add-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
    }
    .daily-quick-memo-input {
      min-width: 0;
      width: 100%;
      box-sizing: border-box;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.95rem;
      transition: all 0.2s ease;
      outline: none;
    }
    .daily-quick-add-btn {
      padding: 0 22px;
      background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
    }
    .daily-quick-add-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
    }
    .data-stats-card {
      margin-top: 20px;
      padding: 16px 18px;
      border-radius: 12px;
      transition: all 0.2s ease;
    }
    .data-stats-card h4 {
      margin: 0 0 10px;
      font-size: 1rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .rank-crown-mini {
      font-size: 0.95rem;
      margin-left: 4px;
    }
    .stat-completed {
      color: #10b981;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .stat-pending {
      color: #64748b;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    /* ========================================================
       1. 浅色模式 (Light Mode) - 优雅质感与层次优化
       ======================================================== */
    html[data-theme="light"] body {
      background: #f4f6fa !important;
      color: #0f172a !important;
    }
    /* 浅色模式：顶栏全新升级为高阶微磨砂纯净底色（告别生硬深蓝） */
    html[data-theme="light"] header.app-topbar {
      background: rgba(255, 255, 255, 0.94) !important;
      backdrop-filter: blur(16px) !important;
      border-bottom: 1px solid #e2e8f0 !important;
      color: #0f172a !important;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04), 0 6px 20px -4px rgba(15, 23, 42, 0.03) !important;
    }
    html[data-theme="light"] .app-brand .app-title {
      color: #0f172a !important;
      font-weight: 800 !important;
    }
    html[data-theme="light"] .topbar-user-badge {
      background: #f1f5f9 !important;
      border: 1px solid #e2e8f0 !important;
      color: #334155 !important;
    }
    html[data-theme="light"] .topbar-user-badge strong {
      color: #0f172a !important;
    }
    html[data-theme="light"] .topbar-nav {
      background: #f1f5f9 !important;
      border: 1px solid #e2e8f0 !important;
    }
    html[data-theme="light"] .topbar-nav .nav-button {
      color: #475569 !important;
    }
    html[data-theme="light"] .topbar-nav .nav-button:hover {
      background: #e2e8f0 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .topbar-nav .current-period {
      color: #0f172a !important;
      font-weight: 700 !important;
    }
    html[data-theme="light"] .topbar-nav .today-btn {
      background: #2563eb !important;
      color: #ffffff !important;
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25) !important;
    }
    html[data-theme="light"] .topbar-nav .today-btn:hover {
      background: #1d4ed8 !important;
      color: #ffffff !important;
    }
    html[data-theme="light"] .topbar-member-selector {
      color: #475569 !important;
    }
    html[data-theme="light"] .topbar-member-selector select {
      background: #f1f5f9 !important;
      border: 1px solid #e2e8f0 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .topbar-theme-toggle,
    html[data-theme="light"] .topbar-logout-btn {
      background: #f1f5f9 !important;
      border: 1px solid #e2e8f0 !important;
      color: #475569 !important;
    }
    html[data-theme="light"] .topbar-theme-toggle:hover,
    html[data-theme="light"] .topbar-logout-btn:hover {
      background: #e2e8f0 !important;
      color: #0f172a !important;
    }

    html[data-theme="light"] .toolbar.workspace-subbar {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 2px 10px -2px rgba(15, 23, 42, 0.04) !important;
      border-radius: 12px !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    html[data-theme="light"] .search-container {
      background: #f8fafc !important;
      border: 1.5px solid #e2e8f0 !important;
      border-radius: 8px !important;
    }
    html[data-theme="light"] .search-container:focus-within {
      background: #ffffff !important;
      border-color: #2563eb !important;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
    }
    html[data-theme="light"] .search-input {
      background: transparent !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .search-icon {
      color: #64748b !important;
    }
    html[data-theme="light"] .month-count-selector {
      color: #475569 !important;
    }
    html[data-theme="light"] .month-count-selector select {
      background: #f8fafc !important;
      border: 1.5px solid #e2e8f0 !important;
      border-radius: 8px !important;
      color: #0f172a !important;
    }

    /* 浅色模式：月历卡片与网格（纯白卡片+细描边+清晰网格） */
    html[data-theme="light"] .month-calendar {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 16px !important;
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05), 0 2px 6px -1px rgba(15, 23, 42, 0.02) !important;
    }
    html[data-theme="light"] .month-header {
      border-bottom: 1px solid #f1f5f9 !important;
    }
    html[data-theme="light"] .month-title {
      color: #0f172a !important;
      font-weight: 800 !important;
      font-size: 1.35rem !important;
    }
    html[data-theme="light"] .stat-item {
      background: #f8fafc !important;
      border: 1px solid #e2e8f0 !important;
      color: #334155 !important;
      font-weight: 700 !important;
      border-radius: 999px !important;
    }
    html[data-theme="light"] .stat-item.total {
      color: #2563eb !important;
      background: #eff6ff !important;
      border-color: #bfdbfe !important;
    }
    html[data-theme="light"] .stat-item.completed {
      color: #059669 !important;
      background: #ecfdf5 !important;
      border-color: #a7f3d0 !important;
    }
    html[data-theme="light"] .stat-item.pending {
      color: #dc2626 !important;
      background: #fef2f2 !important;
      border-color: #fecaca !important;
    }
    html[data-theme="light"] .stat-item.active {
      box-shadow: 0 0 0 2px currentColor !important;
    }
    html[data-theme="light"] .weekdays div {
      background: #f8fafc !important;
      color: #64748b !important;
      font-weight: 600 !important;
      border-radius: 6px !important;
    }
    html[data-theme="light"] .calendar-day {
      background-color: #ffffff !important;
      border: 1px solid #e8ecf4 !important;
      border-radius: 8px !important;
      transition: all 0.15s ease !important;
    }
    html[data-theme="light"] .calendar-day:hover {
      background-color: #f8faff !important;
      border-color: #93c5fd !important;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.08) !important;
    }
    html[data-theme="light"] .calendar-day.other-month {
      background-color: #fafbfc !important;
      border-color: #f1f5f9 !important;
      color: #94a3b8 !important;
      opacity: 0.55 !important;
    }
    html[data-theme="light"] .calendar-day.today {
      background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%) !important;
      border: 1.5px solid #2563eb !important;
      box-shadow: inset 0 0 0 1px #2563eb, 0 2px 8px rgba(37, 99, 235, 0.15) !important;
    }
    html[data-theme="light"] .calendar-day .day-number {
      color: #1e293b !important;
      font-weight: 600 !important;
      font-size: 0.92rem !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      width: 100% !important;
    }
    .calendar-day .day-add {
      opacity: 0;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: none;
      background: rgba(37, 99, 235, 0.12);
      color: #2563eb;
      font-size: 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.18s ease;
      padding: 0;
      line-height: 1;
    }
    html[data-theme="light"] .calendar-day:hover .day-add {
      opacity: 1;
    }
    html[data-theme="light"] .calendar-day .day-add:hover {
      background: #2563eb;
      color: #ffffff !important;
      transform: scale(1.15);
    }
    #dailyDetailList .empty-state {
      cursor: pointer;
      padding: 20px 14px;
      border-radius: 12px;
      transition: all 0.2s ease;
    }
    #dailyDetailList .empty-state:hover {
      background: rgba(37, 99, 235, 0.06);
      transform: scale(1.02);
    }
    html[data-theme="light"] .day-memo-item {
      background-color: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-left: 3.5px solid var(--memo-color, #3b82f6) !important;
      border-radius: 6px !important;
      color: #1e293b !important;
      font-weight: 400 !important;
      font-size: 0.8125rem !important;
      line-height: 1.38 !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
      transition: all 0.15s ease !important;
    }
    html[data-theme="light"] .day-memo-item:hover {
      background-color: #f8fafc !important;
      border-color: #cbd5e1 !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.08) !important;
    }
    html[data-theme="light"] .day-memo-item.completed {
      background-color: #f8fafc !important;
      color: #94a3b8 !important;
      font-weight: 400 !important;
      text-decoration: line-through !important;
      text-decoration-thickness: 1px !important;
      text-decoration-color: rgba(148, 163, 184, 0.75) !important;
      border-color: #edf2f7 !important;
      opacity: 0.7 !important;
    }
    html[data-theme="light"] .memo-count {
      background: #f1f5f9 !important;
      color: #475569 !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 999px !important;
      font-weight: 600 !important;
      font-size: 0.72rem !important;
    }

    /* 浅色模式：团队完成竞赛榜 (彻底解决文字白透问题并优雅升级) */
    html[data-theme="light"] .team-leaderboard {
      background: linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%) !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 16px !important;
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05), 0 2px 6px -1px rgba(15, 23, 42, 0.02) !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .leaderboard-header h2 {
      color: #0f172a !important;
      font-weight: 800 !important;
    }
    html[data-theme="light"] .leaderboard-header p {
      color: #64748b !important;
    }
    html[data-theme="light"] .leaderboard-kicker {
      color: #4338ca !important;
      background: #eef2ff !important;
      border: 1px solid #e0e7ff !important;
      border-radius: 999px !important;
      padding: 3px 12px !important;
      font-weight: 700 !important;
      width: fit-content !important;
    }
    html[data-theme="light"] .leaderboard-champion {
      background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%) !important;
      border: 1.5px solid #fde68a !important;
      box-shadow: 0 4px 14px rgba(245, 158, 11, 0.16) !important;
      color: #78350f !important;
      border-radius: 14px !important;
    }
    html[data-theme="light"] .leaderboard-champion .champion-label {
      color: #92400e !important;
      font-weight: 700 !important;
    }
    html[data-theme="light"] .leaderboard-champion strong {
      color: #78350f !important;
      font-weight: 800 !important;
    }
    html[data-theme="light"] .leaderboard-champion .champion-crown {
      background: #fef08a !important;
      border: 1px solid #fde047 !important;
      box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6) !important;
    }
    html[data-theme="light"] .leaderboard-card {
      background: #ffffff !important;
      border: 1px solid #eef2f6 !important;
      border-radius: 14px !important;
      box-shadow: 0 2px 8px -1px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.02) !important;
      transition: all 0.2s ease !important;
    }
    html[data-theme="light"] .leaderboard-card:hover {
      background: #ffffff !important;
      border-color: #cbd5e1 !important;
      box-shadow: 0 12px 28px -6px rgba(15, 23, 42, 0.09) !important;
      transform: translateY(-2px) !important;
    }
    html[data-theme="light"] .leaderboard-card.rank-1 {
      background: linear-gradient(145deg, #ffffff 50%, #fffdf0 100%) !important;
      border: 1.5px solid #fef08a !important;
      box-shadow: 0 4px 18px rgba(234, 179, 8, 0.14) !important;
    }
    html[data-theme="light"] .leaderboard-card.rank-1 .leaderboard-rank {
      background: linear-gradient(135deg, #f59e0b, #d97706) !important;
      box-shadow: 0 2px 6px rgba(245, 158, 11, 0.35) !important;
    }
    html[data-theme="light"] .leaderboard-card.rank-2 .leaderboard-rank {
      background: linear-gradient(135deg, #94a3b8, #64748b) !important;
    }
    html[data-theme="light"] .leaderboard-card.rank-3 .leaderboard-rank {
      background: linear-gradient(135deg, #d97706, #b45309) !important;
    }
    html[data-theme="light"] .leaderboard-card.active {
      outline: 2.5px solid #2563eb !important;
      outline-offset: 2px !important;
    }
    html[data-theme="light"] .leaderboard-name {
      color: #0f172a !important;
      font-weight: 700 !important;
    }
    html[data-theme="light"] .leaderboard-role {
      color: #64748b !important;
    }
    html[data-theme="light"] .leaderboard-rate {
      color: #2563eb !important;
      font-weight: 800 !important;
    }
    html[data-theme="light"] .leaderboard-card.is-complete .leaderboard-rate {
      color: #059669 !important;
    }
    html[data-theme="light"] .leaderboard-bar {
      background: #f1f5f9 !important;
      height: 7px !important;
    }
    html[data-theme="light"] .leaderboard-bar-fill {
      background: linear-gradient(90deg, #3b82f6, #6366f1) !important;
    }
    html[data-theme="light"] .leaderboard-card.is-complete .leaderboard-bar-fill {
      background: linear-gradient(90deg, #10b981, #059669) !important;
    }
    html[data-theme="light"] .leaderboard-stats {
      color: #64748b !important;
    }
    html[data-theme="light"] .leaderboard-empty {
      background: #f8fafc !important;
      border: 1px dashed #cbd5e1 !important;
      color: #64748b !important;
    }

    /* 浅色模式：研发大屏 (Dashboard) */
    html[data-theme="light"] .dashboard-page {
      background: radial-gradient(circle at 12% 8%, rgba(14, 165, 233, 0.07), transparent 35%),
                  radial-gradient(circle at 92% 10%, rgba(99, 102, 241, 0.06), transparent 35%),
                  linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%) !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06) !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .dashboard-hero {
      background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%) !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04) !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .dashboard-kicker {
      color: #0284c7 !important;
    }
    html[data-theme="light"] .kicker-pulse-dot {
      background: #0284c7 !important;
      box-shadow: 0 0 6px rgba(2, 132, 199, 0.4) !important;
    }
    html[data-theme="light"] #dashboardTitle {
      color: #0f172a !important;
      font-weight: 850 !important;
    }
    html[data-theme="light"] #dashboardSubtitle {
      color: #64748b !important;
    }
    html[data-theme="light"] .dashboard-actions .btn-secondary {
      background: #f1f5f9 !important;
      border: 1px solid #cbd5e1 !important;
      color: #334155 !important;
    }
    html[data-theme="light"] .dashboard-actions .btn-secondary:hover {
      background: #e2e8f0 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .dashboard-actions .btn-primary {
      background: linear-gradient(135deg, #0284c7, #2563eb) !important;
      border: 1px solid transparent !important;
      color: #ffffff !important;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25) !important;
    }
    html[data-theme="light"] .dashboard-metric {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04) !important;
    }
    html[data-theme="light"] .dashboard-metric-label {
      color: #64748b !important;
    }
    html[data-theme="light"] .dashboard-metric-value {
      color: #0f172a !important;
      font-weight: 900 !important;
    }
    html[data-theme="light"] .dashboard-card {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04) !important;
    }
    html[data-theme="light"] .dashboard-card-title {
      border-bottom: 1px solid #f1f5f9 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .dashboard-card-title span {
      color: #0f172a !important;
      font-weight: 800 !important;
    }
    html[data-theme="light"] .dashboard-card-title small {
      color: #64748b !important;
    }
    html[data-theme="light"] .dashboard-user-row {
      background: #ffffff !important;
      border: 1px solid #f1f5f9 !important;
    }
    html[data-theme="light"] .dashboard-user-row:hover {
      background: #f8fafc !important;
      border-color: #cbd5e1 !important;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05) !important;
    }
    html[data-theme="light"] .dashboard-user-name {
      color: #0f172a !important;
    }
    html[data-theme="light"] .dashboard-user-rate {
      color: #0284c7 !important;
    }
    html[data-theme="light"] .dashboard-risk-item {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
    }
    html[data-theme="light"] .dashboard-risk-title {
      color: #0f172a !important;
    }
    html[data-theme="light"] .dashboard-risk-meta {
      color: #64748b !important;
    }

    /* 浅色模式：弹窗与组件深度美化 */
    html[data-theme="light"] .modal-content {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 16px !important;
      box-shadow: 0 20px 45px -10px rgba(15, 23, 42, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.04) !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .modal-header {
      background: #ffffff !important;
      border-bottom: 1px solid #f1f5f9 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .modal-title {
      color: #0f172a !important;
      font-weight: 800 !important;
    }
    html[data-theme="light"] .close-modal {
      background: #f1f5f9 !important;
      color: #64748b !important;
      border-radius: 50% !important;
      border: none !important;
      width: 32px !important;
      height: 32px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    html[data-theme="light"] .close-modal:hover {
      background: #e2e8f0 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .modal-footer {
      background: #fafbfc !important;
      border-top: 1px solid #f1f5f9 !important;
    }
    html[data-theme="light"] .tabs {
      border-bottom: 1.5px solid #e2e8f0 !important;
    }
    html[data-theme="light"] .tab {
      color: #64748b !important;
      font-weight: 600 !important;
      border-radius: 8px 8px 0 0 !important;
      border-bottom: 2px solid transparent !important;
    }
    html[data-theme="light"] .tab:hover {
      color: #2563eb !important;
      background: rgba(37, 99, 235, 0.04) !important;
    }
    html[data-theme="light"] .tab.active {
      color: #2563eb !important;
      border-bottom-color: #2563eb !important;
      font-weight: 700 !important;
    }
    html[data-theme="light"] .form-control,
    html[data-theme="light"] .memo-input,
    html[data-theme="light"] textarea {
      background-color: #f8fafc !important;
      border: 1.5px solid #cbd5e1 !important;
      border-radius: 8px !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .form-control:focus,
    html[data-theme="light"] .memo-input:focus,
    html[data-theme="light"] textarea:focus {
      background-color: #ffffff !important;
      border-color: #2563eb !important;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
    }
    html[data-theme="light"] .excel-export-panel {
      background: linear-gradient(135deg, #f8faff 0%, #f0f5ff 100%) !important;
      border: 1.5px solid #dbeafe !important;
      border-radius: 14px !important;
    }
    html[data-theme="light"] .excel-export-panel h4 {
      color: #1e40af !important;
    }
    html[data-theme="light"] .excel-export-panel p {
      color: #64748b !important;
    }
    html[data-theme="light"] .excel-export-grid > label {
      color: #334155 !important;
      font-weight: 700 !important;
    }
    html[data-theme="light"] .excel-export-grid > label input,
    html[data-theme="light"] .excel-export-grid > label select {
      background: #ffffff !important;
      border: 1.5px solid #cbd5e1 !important;
      border-radius: 8px !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .excel-user-picker-heading {
      color: #334155 !important;
      font-weight: 700 !important;
    }
    html[data-theme="light"] .excel-selection-count {
      background: #e0e7ff !important;
      color: #4338ca !important;
    }
    html[data-theme="light"] .excel-user-picker {
      background: #ffffff !important;
      border: 1.5px solid #e2e8f0 !important;
      border-radius: 10px !important;
    }
    html[data-theme="light"] .excel-user-option {
      background: #f8fafc !important;
      border: 1.5px solid #e2e8f0 !important;
      border-radius: 8px !important;
      color: #1e293b !important;
    }
    html[data-theme="light"] .excel-user-option:hover {
      border-color: #3b82f6 !important;
      background: #ffffff !important;
    }
    html[data-theme="light"] .excel-user-option.selected {
      background: #eff6ff !important;
      border-color: #2563eb !important;
    }
    html[data-theme="light"] .excel-user-option-name {
      color: #0f172a !important;
    }
    html[data-theme="light"] .excel-user-option-meta {
      color: #64748b !important;
    }
    html[data-theme="light"] .daily-quick-add-box {
      background-color: #f8fafc !important;
      border: 1.5px dashed #cbd5e1 !important;
    }
    html[data-theme="light"] .daily-quick-add-title {
      color: #334155 !important;
    }
    html[data-theme="light"] .daily-quick-memo-input {
      background: #ffffff !important;
      border: 1.5px solid #cbd5e1 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .daily-quick-memo-input:focus {
      border-color: #2563eb !important;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
    }
    html[data-theme="light"] .data-stats-card {
      background-color: #f8fafc !important;
      border: 1px solid #e2e8f0 !important;
      color: #334155 !important;
    }
    html[data-theme="light"] .task-assignee-panel {
      background: #f8fafc !important;
      border: 1.5px solid #e2e8f0 !important;
      border-radius: 12px !important;
    }
    html[data-theme="light"] .task-assignee-modes {
      background: #edf2f7 !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 999px !important;
    }
    html[data-theme="light"] .task-assignee-mode {
      color: #475569 !important;
    }
    html[data-theme="light"] .task-assignee-mode.active {
      background: #ffffff !important;
      color: #2563eb !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08) !important;
    }
    html[data-theme="light"] .assignee-tag {
      background: #ffffff !important;
      border: 1.5px solid #e2e8f0 !important;
      color: #334155 !important;
      border-radius: 999px !important;
    }
    html[data-theme="light"] .assignee-tag:hover {
      border-color: #3b82f6 !important;
      background: #f0f7ff !important;
    }
    html[data-theme="light"] .assignee-tag.selected {
      background: #eff6ff !important;
      border-color: #2563eb !important;
      color: #1d4ed8 !important;
    }
    html[data-theme="light"] .user-management-item {
      background: #f8fafc !important;
      border: 1.5px solid #e2e8f0 !important;
      border-radius: 12px !important;
    }
    html[data-theme="light"] .user-field label {
      color: #475569 !important;
      font-weight: 600 !important;
    }
    html[data-theme="light"] .user-edit-grid input,
    html[data-theme="light"] .user-edit-grid select {
      background: #ffffff !important;
      border: 1.5px solid #cbd5e1 !important;
      border-radius: 6px !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .memo-text-editor {
      border: 1.5px solid #cbd5e1 !important;
      border-radius: 10px !important;
      overflow: hidden !important;
    }
    html[data-theme="light"] .memo-text-toolbar {
      background: #f8fafc !important;
      border-bottom: 1px solid #e2e8f0 !important;
    }
    html[data-theme="light"] .memo-text-tool {
      color: #475569 !important;
    }
    html[data-theme="light"] .memo-text-tool:hover {
      background: #edf2f7 !important;
      color: #2563eb !important;
    }
    html[data-theme="light"] .memo-text-separator {
      background: #e2e8f0 !important;
    }
    html[data-theme="light"] .markdown-preview {
      background: #f8fafc !important;
      border: 1.5px solid #cbd5e1 !important;
      border-radius: 10px !important;
      color: #1e293b !important;
    }
    html[data-theme="light"] .reminder-content {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 16px !important;
    }
    html[data-theme="light"] .reminder-item {
      background-color: #fffbeb !important;
      border: 1px solid #fef3c7 !important;
      border-left: 4px solid #f59e0b !important;
      border-radius: 10px !important;
    }
    html[data-theme="light"] .reminder-actions {
      background: #f8fafc !important;
      border-top: 1px solid #e2e8f0 !important;
    }

    /* 浅色模式：标记完成按钮组件 */
    html[data-theme="light"] .memo-title-completed {
      background: #f8fafc !important;
      border: 1.5px solid #cbd5e1 !important;
      color: #334155 !important;
      border-radius: 8px !important;
      font-weight: 600 !important;
      padding: 8px 14px !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    html[data-theme="light"] .memo-title-completed:hover {
      background: #eff6ff !important;
      border-color: #3b82f6 !important;
      color: #2563eb !important;
    }
    html[data-theme="light"] .memo-title-completed.is-completed,
    html[data-theme="light"] .memo-title-completed:has(input:checked) {
      background: rgba(16, 185, 129, 0.12) !important;
      border-color: #10b981 !important;
      color: #059669 !important;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.16) !important;
    }
    html[data-theme="light"] .memo-title-completed input {
      accent-color: #10b981 !important;
    }

    /* 浅色模式：通用与功能按钮优雅提升 */
    html[data-theme="light"] .btn {
      border-radius: 8px !important;
      font-weight: 700 !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    html[data-theme="light"] .btn-primary {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
      color: #ffffff !important;
      border: none !important;
      box-shadow: 0 3px 10px rgba(37, 99, 235, 0.25) !important;
    }
    html[data-theme="light"] .btn-primary:hover {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 15px rgba(37, 99, 235, 0.35) !important;
    }
    html[data-theme="light"] .btn-secondary {
      background: #f1f5f9 !important;
      border: 1px solid #cbd5e1 !important;
      color: #334155 !important;
    }
    html[data-theme="light"] .btn-secondary:hover {
      background: #e2e8f0 !important;
      border-color: #94a3b8 !important;
      color: #0f172a !important;
      transform: translateY(-1px) !important;
    }
    html[data-theme="light"] .btn-success {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
      color: #ffffff !important;
      border: none !important;
      box-shadow: 0 3px 10px rgba(16, 185, 129, 0.25) !important;
    }
    html[data-theme="light"] .btn-success:hover {
      background: linear-gradient(135deg, #059669 0%, #047857 100%) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 15px rgba(16, 185, 129, 0.35) !important;
    }
    html[data-theme="light"] .btn-danger {
      background: #ef4444 !important;
      border: 1px solid #dc2626 !important;
      color: #ffffff !important;
      box-shadow: 0 3px 10px rgba(239, 68, 68, 0.22) !important;
    }
    html[data-theme="light"] .btn-danger:hover {
      background: #dc2626 !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 15px rgba(239, 68, 68, 0.35) !important;
    }
    html[data-theme="light"] .btn-warning {
      background: #f59e0b !important;
      border: 1px solid #d97706 !important;
      color: #ffffff !important;
      box-shadow: 0 3px 10px rgba(245, 158, 11, 0.22) !important;
    }
    html[data-theme="light"] .btn-warning:hover {
      background: #d97706 !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 15px rgba(245, 158, 11, 0.35) !important;
    }
    html[data-theme="light"] .toolbar-btn-secondary {
      background: #f1f5f9 !important;
      border: 1px solid #cbd5e1 !important;
      color: #334155 !important;
    }
    html[data-theme="light"] .toolbar-btn-secondary:hover {
      background: #e2e8f0 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .toolbar-btn-primary {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
      color: #ffffff !important;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25) !important;
      border: none !important;
    }
    html[data-theme="light"] .toolbar-btn-primary:hover {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35) !important;
    }
    html[data-theme="light"] .toolbar-btn-success {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
      color: #ffffff !important;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.22) !important;
      border: none !important;
    }
    html[data-theme="light"] .toolbar-btn-success:hover {
      background: linear-gradient(135deg, #059669 0%, #047857 100%) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35) !important;
    }
    html[data-theme="light"] .floating-btn {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
      color: #ffffff !important;
      box-shadow: 0 8px 24px -4px rgba(37, 99, 235, 0.4), 0 2px 6px rgba(0, 0, 0, 0.08) !important;
      border: 2px solid #ffffff !important;
    }
    html[data-theme="light"] .floating-btn:hover {
      transform: translateY(-3px) scale(1.06) !important;
      box-shadow: 0 12px 28px -4px rgba(37, 99, 235, 0.5), 0 4px 10px rgba(0, 0, 0, 0.12) !important;
    }
    html[data-theme="light"] .task-item {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-left-width: 4px !important;
      border-left-style: solid !important;
      border-radius: 12px !important;
      padding: 14px 16px !important;
      margin-bottom: 12px !important;
      box-shadow: 0 2px 8px -2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.02) !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    html[data-theme="light"] .task-item:hover {
      background: #fbfcfe !important;
      border-color: #cbd5e1 !important;
      box-shadow: 0 8px 20px -4px rgba(15, 23, 42, 0.08) !important;
      transform: translateY(-1px) !important;
    }
    html[data-theme="light"] .task-title {
      color: #0f172a !important;
      font-weight: 700 !important;
      font-size: 0.96rem !important;
    }
    html[data-theme="light"] .task-due {
      color: #64748b !important;
      font-size: 0.82rem !important;
      font-weight: 500 !important;
    }
    html[data-theme="light"] .task-content {
      color: #334155 !important;
      font-size: 0.88rem !important;
      line-height: 1.55 !important;
    }
    html[data-theme="light"] .ops-card {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 14px !important;
      padding: 16px !important;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04) !important;
    }
    html[data-theme="light"] .ops-card-title {
      color: #64748b !important;
      font-weight: 700 !important;
    }
    html[data-theme="light"] .ops-card-value {
      color: #0f172a !important;
      font-weight: 800 !important;
    }
    html[data-theme="light"] .ops-card-subtitle {
      color: #64748b !important;
    }
    html[data-theme="light"] .ops-section {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 14px !important;
      padding: 18px !important;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03) !important;
    }
    html[data-theme="light"] .ops-section h4 {
      color: #0f172a !important;
      font-weight: 700 !important;
    }
    html[data-theme="light"] .ops-disk-item {
      background: #f8fafc !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 10px !important;
    }
    html[data-theme="light"] .ops-disk-top {
      color: #0f172a !important;
    }
    html[data-theme="light"] .ops-progress {
      background: #e2e8f0 !important;
    }
    html[data-theme="light"] .ops-info-row {
      background: #f8fafc !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 8px !important;
      color: #334155 !important;
    }
    html[data-theme="light"] .ops-info-row strong {
      color: #0f172a !important;
    }
    html[data-theme="light"] .ops-note-list {
      color: #64748b !important;
    }
    html[data-theme="light"] .task-btn {
      border-radius: 6px !important;
      font-weight: 600 !important;
      padding: 5px 10px !important;
      border: 1px solid transparent !important;
      transition: all 0.2s ease !important;
    }
    html[data-theme="light"] .task-btn-complete {
      background: rgba(16, 185, 129, 0.12) !important;
      color: #059669 !important;
      border-color: rgba(16, 185, 129, 0.25) !important;
    }
    html[data-theme="light"] .task-btn-complete:hover {
      background: #10b981 !important;
      color: #ffffff !important;
    }
    html[data-theme="light"] .task-btn-edit {
      background: rgba(37, 99, 235, 0.1) !important;
      color: #2563eb !important;
      border-color: rgba(37, 99, 235, 0.25) !important;
    }
    html[data-theme="light"] .task-btn-edit:hover {
      background: #2563eb !important;
      color: #ffffff !important;
    }
    html[data-theme="light"] .task-btn-delete {
      background: rgba(239, 68, 68, 0.1) !important;
      color: #dc2626 !important;
      border-color: rgba(239, 68, 68, 0.25) !important;
    }
    html[data-theme="light"] .task-btn-delete:hover {
      background: #ef4444 !important;
      color: #ffffff !important;
    }
    html[data-theme="light"] .user-save-btn {
      background: rgba(16, 185, 129, 0.12) !important;
      color: #059669 !important;
      border-color: rgba(16, 185, 129, 0.25) !important;
    }
    html[data-theme="light"] .user-save-btn:hover {
      background: #10b981 !important;
      color: #ffffff !important;
    }
    html[data-theme="light"] .user-delete-btn:disabled {
      background: #f1f5f9 !important;
      color: #94a3b8 !important;
      border-color: #e2e8f0 !important;
      opacity: 0.6 !important;
      cursor: not-allowed !important;
    }
    html[data-theme="light"] .reminder-header {
      background: #ffffff !important;
      border-bottom: 1px solid #f1f5f9 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .close-reminder {
      background: #f1f5f9 !important;
      color: #64748b !important;
      border-radius: 50% !important;
      border: none !important;
      width: 32px !important;
      height: 32px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    html[data-theme="light"] .close-reminder:hover {
      background: #e2e8f0 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] .color-option.selected {
      border: 2px solid #0f172a !important;
      box-shadow: 0 0 0 2px #ffffff, 0 2px 8px rgba(0, 0, 0, 0.2) !important;
      transform: scale(1.15) !important;
    }

    /* 浅色模式：登录界面（纯静态、零光效、零动效） */
    html[data-theme="light"] #serverLoginOverlay {
      background: #f1f5f9 !important;
    }
    html[data-theme="light"] .server-login-container {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 15px 35px rgba(15, 23, 42, 0.08) !important;
    }
    html[data-theme="light"] .server-login-brand {
      background: #1e3a8a !important;
      border-right: none !important;
    }
    html[data-theme="light"] .server-login-form-area {
      background: #ffffff !important;
    }
    html[data-theme="light"] .server-auth-header-text h2 {
      color: #0f172a !important;
    }
    html[data-theme="light"] .server-auth-header-text p {
      color: #64748b !important;
    }
    html[data-theme="light"] .server-auth-tabs {
      background: #f1f5f9 !important;
      border: 1px solid #e2e8f0 !important;
    }
    html[data-theme="light"] .server-auth-tabs button {
      color: #64748b !important;
    }
    html[data-theme="light"] .server-auth-tabs button.active {
      background: #ffffff !important;
      color: #0f172a !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
    }
    html[data-theme="light"] .server-form-field label {
      color: #334155 !important;
    }
    html[data-theme="light"] .server-input-box,
    html[data-theme="light"] .server-select-box {
      background: #f8fafc !important;
      border: 1.5px solid #e2e8f0 !important;
      border-radius: 10px !important;
    }
    html[data-theme="light"] .server-input-box:focus-within,
    html[data-theme="light"] .server-select-box:focus-within {
      background: #ffffff !important;
      border-color: #2563eb !important;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
    }
    html[data-theme="light"] .server-input-box input,
    html[data-theme="light"] .server-select-box select {
      background: transparent !important;
      border: 0 !important;
      color: #0f172a !important;
      outline: none !important;
      box-shadow: none !important;
    }
    html[data-theme="light"] .server-input-box input:-webkit-autofill,
    html[data-theme="light"] .server-input-box input:-webkit-autofill:hover,
    html[data-theme="light"] .server-input-box input:-webkit-autofill:focus,
    html[data-theme="light"] .server-input-box input:-webkit-autofill:active {
      -webkit-text-fill-color: #0f172a !important;
      -webkit-box-shadow: 0 0 0 1000px #f8fafc inset !important;
      box-shadow: 0 0 0 1000px #f8fafc inset !important;
      transition: background-color 5000s ease-in-out 0s !important;
    }
    html[data-theme="light"] .server-remember-row {
      color: #475569 !important;
    }
    html[data-theme="light"] .server-form-footer {
      border-top-color: #f1f5f9 !important;
      color: #94a3b8 !important;
    }

    /* ========================================================
       2. 深色模式 (Dark Mode) - 深度适配所有弹窗与面板
       ======================================================== */
    html[data-theme="dark"] body {
      background: radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.08) 0%, transparent 60%),
                  radial-gradient(circle at 10% 40%, rgba(99, 102, 241, 0.05) 0%, transparent 40%),
                  #080c14 !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] header.app-topbar {
      background: rgba(11, 16, 28, 0.88) !important;
      backdrop-filter: blur(16px) !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      color: #f8fafc !important;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6) !important;
    }
    html[data-theme="dark"] .topbar-user-badge {
      background: rgba(255, 255, 255, 0.08) !important;
      border: 1px solid rgba(255, 255, 255, 0.12) !important;
      color: #e2e8f0 !important;
    }
    html[data-theme="dark"] .topbar-nav {
      background: #141d33 !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
    }
    html[data-theme="dark"] .topbar-nav .nav-button {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .topbar-nav .nav-button:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .topbar-nav .current-period {
      color: #f8fafc !important;
      font-weight: 700 !important;
    }
    html[data-theme="dark"] .topbar-nav .today-btn {
      background: #3b82f6 !important;
      color: #ffffff !important;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35) !important;
    }
    html[data-theme="dark"] .topbar-nav .today-btn:hover {
      background: #2563eb !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .topbar-member-selector {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .topbar-member-selector select {
      background: #141d33 !important;
      border: 1px solid rgba(255, 255, 255, 0.1) !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .topbar-theme-toggle,
    html[data-theme="dark"] .topbar-logout-btn {
      background: #141d33 !important;
      border: 1px solid rgba(255, 255, 255, 0.1) !important;
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .topbar-theme-toggle:hover,
    html[data-theme="dark"] .topbar-logout-btn:hover {
      background: #1e2b48 !important;
      color: #f8fafc !important;
    }

    /* 深色模式：工作台副工具栏 (Layer 1) */
    html[data-theme="dark"] .toolbar.workspace-subbar {
      background: rgba(14, 21, 37, 0.85) !important;
      backdrop-filter: blur(12px) !important;
      border: 1px solid rgba(255, 255, 255, 0.07) !important;
      border-radius: 12px !important;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4) !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    html[data-theme="dark"] .search-container {
      background: #0b1120 !important;
      border: 1.5px solid rgba(255, 255, 255, 0.1) !important;
      border-radius: 8px !important;
    }
    html[data-theme="dark"] .search-container:focus-within {
      border-color: #3b82f6 !important;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25) !important;
    }
    html[data-theme="dark"] .search-input {
      background: transparent !important;
      border: none !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .search-icon {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .month-count-selector {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .month-count-selector select {
      background: #0b1120 !important;
      border: 1.5px solid rgba(255, 255, 255, 0.1) !important;
      color: #f1f5f9 !important;
      color-scheme: dark !important;
      border-radius: 8px !important;
    }

    /* 深色模式：日历主卡片 (Layer 2 稍亮蓝灰承载卡片 + 顶光反射) */
    html[data-theme="dark"] .month-calendar {
      background: linear-gradient(180deg, #131d33 0%, #0f172a 100%) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-top: 1px solid rgba(255, 255, 255, 0.15) !important;
      border-radius: 16px !important;
      box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.04) !important;
    }
    html[data-theme="dark"] .month-header {
      color: #f8fafc !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07) !important;
    }
    html[data-theme="dark"] .month-title {
      color: #f8fafc !important;
      font-weight: 800 !important;
      font-size: 1.35rem !important;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3) !important;
    }
    html[data-theme="dark"] .stat-item {
      background: #141f36 !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      color: #cbd5e1 !important;
      font-weight: 700 !important;
      border-radius: 999px !important;
    }
    html[data-theme="dark"] .stat-item.total {
      color: #60a5fa !important;
      background: rgba(37, 99, 235, 0.16) !important;
      border-color: rgba(37, 99, 235, 0.35) !important;
    }
    html[data-theme="dark"] .stat-item.completed {
      color: #34d399 !important;
      background: rgba(16, 185, 129, 0.16) !important;
      border-color: rgba(16, 185, 129, 0.35) !important;
    }
    html[data-theme="dark"] .stat-item.pending {
      color: #f87171 !important;
      background: rgba(239, 68, 68, 0.16) !important;
      border-color: rgba(239, 68, 68, 0.35) !important;
    }
    html[data-theme="dark"] .stat-item.active {
      box-shadow: 0 0 10px rgba(59, 130, 246, 0.4) !important;
      border-color: #3b82f6 !important;
    }
    html[data-theme="dark"] .weekdays div {
      background: #0b1120 !important;
      color: #94a3b8 !important;
      font-weight: 700 !important;
      border-radius: 6px !important;
    }

    /* 深色模式：日历单元格 (Layer 3 内凹沉浸网格 + 实线细描边) */
    html[data-theme="dark"] .calendar-day {
      background-color: #0b1120 !important;
      border: 1px solid rgba(255, 255, 255, 0.05) !important;
      border-radius: 8px !important;
      transition: all 0.15s ease !important;
    }
    html[data-theme="dark"] .calendar-day:hover {
      background-color: #16223b !important;
      border-color: rgba(59, 130, 246, 0.5) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4) !important;
    }
    html[data-theme="dark"] .calendar-day .day-number {
      color: #f8fafc !important;
      font-weight: 600 !important;
      font-size: 0.92rem !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      width: 100% !important;
    }
    html[data-theme="dark"] .calendar-day .day-add {
      background: rgba(59, 130, 246, 0.2) !important;
      color: #93c5fd !important;
    }
    html[data-theme="dark"] .calendar-day:hover .day-add {
      opacity: 1;
    }
    html[data-theme="dark"] .calendar-day .day-add:hover {
      background: #3b82f6 !important;
      color: #ffffff !important;
      transform: scale(1.15);
    }
    html[data-theme="dark"] #dailyDetailList .empty-state:hover {
      background: rgba(59, 130, 246, 0.12);
    }
    html[data-theme="dark"] .calendar-day.other-month {
      background-color: #060a12 !important;
      opacity: 0.35 !important;
      border-color: rgba(255, 255, 255, 0.02) !important;
    }
    html[data-theme="dark"] .calendar-day.today {
      background: rgba(37, 99, 235, 0.16) !important;
      border: 1.5px solid #3b82f6 !important;
      box-shadow: inset 0 0 12px rgba(59, 130, 246, 0.2), 0 0 16px rgba(59, 130, 246, 0.25) !important;
    }

    /* 深色模式：备忘录卡片项 (Layer 4 精致悬浮微卡) */
    html[data-theme="dark"] .day-memo-item {
      background-color: #17243c !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-left: 3.5px solid var(--memo-color, #3b82f6) !important;
      border-radius: 6px !important;
      color: #e2e8f0 !important;
      font-weight: 400 !important;
      font-size: 0.8125rem !important;
      line-height: 1.38 !important;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25) !important;
      transition: all 0.15s ease !important;
    }
    html[data-theme="dark"] .day-memo-item:hover {
      background-color: #213254 !important;
      border-color: rgba(255, 255, 255, 0.18) !important;
      color: #ffffff !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45) !important;
    }
    html[data-theme="dark"] .day-memo-item.completed {
      background-color: #0f1828 !important;
      color: #64748b !important;
      font-weight: 400 !important;
      text-decoration: line-through !important;
      text-decoration-thickness: 1px !important;
      text-decoration-color: rgba(100, 116, 139, 0.75) !important;
      border-color: rgba(255, 255, 255, 0.03) !important;
      opacity: 0.65 !important;
    }
    html[data-theme="dark"] .memo-count {
      background: #162035 !important;
      color: #94a3b8 !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-radius: 999px !important;
      font-weight: 600 !important;
      font-size: 0.72rem !important;
    }

    /* 深色模式：团队完成竞赛榜 (Layer 2 高阶质感) */
    html[data-theme="dark"] .team-leaderboard {
      background: linear-gradient(180deg, #131d33 0%, #0f172a 100%) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-top: 1px solid rgba(255, 255, 255, 0.14) !important;
      box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.7) !important;
      border-radius: 16px !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .leaderboard-header h2 {
      color: #f8fafc !important;
      font-weight: 800 !important;
    }
    html[data-theme="dark"] .leaderboard-header p {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .leaderboard-kicker {
      color: #a5b4fc !important;
      background: rgba(99, 102, 241, 0.16) !important;
      border: 1px solid rgba(99, 102, 241, 0.3) !important;
      border-radius: 999px !important;
      padding: 3px 12px !important;
      width: fit-content !important;
    }
    html[data-theme="dark"] .leaderboard-champion {
      background: rgba(245, 158, 11, 0.12) !important;
      border: 1px solid rgba(245, 158, 11, 0.3) !important;
      color: #fef3c7 !important;
      border-radius: 14px !important;
    }
    html[data-theme="dark"] .leaderboard-champion .champion-label {
      color: #fcd34d !important;
    }
    html[data-theme="dark"] .leaderboard-champion strong {
      color: #fef3c7 !important;
    }
    html[data-theme="dark"] .leaderboard-champion .champion-crown {
      background: rgba(245, 158, 11, 0.25) !important;
      border: 1px solid rgba(245, 158, 11, 0.4) !important;
    }
    html[data-theme="dark"] .leaderboard-card {
      background: #141e34 !important;
      border: 1px solid rgba(255, 255, 255, 0.07) !important;
      color: #f1f5f9 !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35) !important;
      border-radius: 14px !important;
    }
    html[data-theme="dark"] .leaderboard-card:hover {
      background: #192642 !important;
      border-color: rgba(59, 130, 246, 0.45) !important;
      transform: translateY(-2px) !important;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55) !important;
    }
    html[data-theme="dark"] .leaderboard-card.rank-1 {
      background: linear-gradient(145deg, #18233c 60%, rgba(245, 158, 11, 0.16) 100%) !important;
      border: 1.5px solid rgba(245, 158, 11, 0.45) !important;
    }
    html[data-theme="dark"] .leaderboard-name {
      color: #f8fafc !important;
      font-weight: 700 !important;
    }
    html[data-theme="dark"] .leaderboard-role {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .leaderboard-rate {
      color: #60a5fa !important;
      font-weight: 800 !important;
    }
    html[data-theme="dark"] .leaderboard-card.is-complete .leaderboard-rate {
      color: #34d399 !important;
    }
    html[data-theme="dark"] .leaderboard-bar {
      background: rgba(255, 255, 255, 0.08) !important;
      height: 7px !important;
    }
    html[data-theme="dark"] .leaderboard-bar-fill {
      background: linear-gradient(90deg, #3b82f6, #6366f1) !important;
      box-shadow: 0 0 10px rgba(59, 130, 246, 0.3) !important;
    }
    html[data-theme="dark"] .leaderboard-card.is-complete .leaderboard-bar-fill {
      background: linear-gradient(90deg, #10b981, #34d399) !important;
      box-shadow: 0 0 14px rgba(16, 185, 129, 0.45) !important;
    }
    html[data-theme="dark"] .leaderboard-stats {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .leaderboard-empty {
      background: #0d131f !important;
      border: 1px dashed rgba(255, 255, 255, 0.1) !important;
      color: #94a3b8 !important;
    }

    /* 深色模式：研发大屏 (Dashboard - Cyber Data Screen) */
    html[data-theme="dark"] .dashboard-page {
      background: radial-gradient(circle at 10% 8%, rgba(14, 165, 233, 0.16) 0%, transparent 45%),
                  radial-gradient(circle at 92% 12%, rgba(99, 102, 241, 0.14) 0%, transparent 45%),
                  radial-gradient(circle at 50% 95%, rgba(20, 184, 166, 0.08) 0%, transparent 50%),
                  linear-gradient(180deg, #090e1a 0%, #0d1527 100%) !important;
      border: 1px solid rgba(56, 189, 248, 0.2) !important;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.06) !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .dashboard-page::before {
      background-image: linear-gradient(rgba(56, 189, 248, 0.04) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(56, 189, 248, 0.04) 1px, transparent 1px) !important;
      mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.08)) !important;
    }
    html[data-theme="dark"] .dashboard-hero {
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(26, 38, 64, 0.90) 100%) !important;
      border: 1px solid rgba(56, 189, 248, 0.22) !important;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .dashboard-hero::before {
      background: linear-gradient(180deg, #38bdf8, #818cf8) !important;
    }
    html[data-theme="dark"] .dashboard-hero::after {
      background: radial-gradient(circle, rgba(56, 189, 248, 0.15), transparent 64%) !important;
    }
    html[data-theme="dark"] .dashboard-kicker {
      color: #38bdf8 !important;
      text-shadow: 0 0 12px rgba(56, 189, 248, 0.4);
    }
    html[data-theme="dark"] .kicker-pulse-dot {
      background: #38bdf8 !important;
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.8) !important;
    }
    html[data-theme="dark"] #dashboardTitle {
      color: #ffffff !important;
      font-weight: 850 !important;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
    }
    html[data-theme="dark"] #dashboardSubtitle {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .dashboard-actions .btn-secondary {
      background: rgba(30, 41, 59, 0.85) !important;
      border: 1px solid rgba(255, 255, 255, 0.12) !important;
      color: #e2e8f0 !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35) !important;
    }
    html[data-theme="dark"] .dashboard-actions .btn-secondary:hover {
      background: rgba(45, 60, 88, 0.95) !important;
      border-color: rgba(56, 189, 248, 0.45) !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .dashboard-actions .btn-primary {
      background: linear-gradient(135deg, #0284c7, #2563eb) !important;
      border: 1px solid rgba(56, 189, 248, 0.5) !important;
      color: #ffffff !important;
      box-shadow: 0 4px 16px rgba(2, 132, 199, 0.4) !important;
    }
    html[data-theme="dark"] .dashboard-card {
      background: rgba(15, 23, 42, 0.85) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45) !important;
      backdrop-filter: blur(12px) !important;
    }
    html[data-theme="dark"] .dashboard-card-title {
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .dashboard-card-title span {
      color: #ffffff !important;
    }
    html[data-theme="dark"] .dashboard-card-title i {
      color: #38bdf8 !important;
    }
    html[data-theme="dark"] .dashboard-card-title small {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .dashboard-metric {
      background: rgba(15, 23, 42, 0.85) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4) !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .dashboard-metric:hover {
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55), 0 0 16px rgba(56, 189, 248, 0.15) !important;
      border-color: rgba(56, 189, 248, 0.3) !important;
    }
    html[data-theme="dark"] .dashboard-metric-label {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .dashboard-metric-value {
      color: #ffffff !important;
      font-weight: 900 !important;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    }
    html[data-theme="dark"] .dashboard-user-row {
      background: rgba(20, 30, 52, 0.65) !important;
      border: 1px solid rgba(255, 255, 255, 0.06) !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .dashboard-user-row:hover {
      background: rgba(30, 46, 78, 0.9) !important;
      border-color: rgba(56, 189, 248, 0.4) !important;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35) !important;
    }
    html[data-theme="dark"] .dashboard-user-name {
      color: #ffffff !important;
      font-weight: 800 !important;
    }
    html[data-theme="dark"] .dashboard-user-rate {
      color: #38bdf8 !important;
    }
    html[data-theme="dark"] .dashboard-risk-item {
      background: rgba(22, 27, 44, 0.7) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-left: 4px solid #f59e0b !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .dashboard-risk-item:hover {
      background: rgba(30, 38, 62, 0.9) !important;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4) !important;
    }
    html[data-theme="dark"] .dashboard-risk-item.risk-danger {
      background: linear-gradient(135deg, rgba(88, 20, 32, 0.7) 0%, rgba(35, 14, 22, 0.8) 100%) !important;
      border: 1px solid rgba(244, 63, 94, 0.35) !important;
      border-left: 4px solid #f43f5e !important;
    }
    html[data-theme="dark"] .dashboard-risk-item.risk-warning {
      background: linear-gradient(135deg, rgba(78, 42, 12, 0.6) 0%, rgba(30, 20, 12, 0.7) 100%) !important;
      border: 1px solid rgba(245, 158, 11, 0.35) !important;
      border-left: 4px solid #f59e0b !important;
    }
    html[data-theme="dark"] .dashboard-risk-item.risk-muted {
      background: rgba(20, 29, 47, 0.6) !important;
      border: 1px solid rgba(148, 163, 184, 0.2) !important;
      border-left: 4px solid #94a3b8 !important;
    }
    html[data-theme="dark"] .dashboard-risk-title {
      color: #ffffff !important;
      font-weight: 750 !important;
    }
    html[data-theme="dark"] .dashboard-risk-meta {
      color: #cbd5e1 !important;
    }

    /* 深色模式：所有弹窗全量深度适配 (Layer 4 浮层高阶质感) */
    html[data-theme="dark"] .modal-content {
      background-color: #111a2e !important;
      border: 1px solid rgba(255, 255, 255, 0.1) !important;
      border-top: 1px solid rgba(255, 255, 255, 0.18) !important;
      color: #f8fafc !important;
      box-shadow: 0 25px 70px rgba(0, 0, 0, 0.85) !important;
    }
    html[data-theme="dark"] .modal-header {
      background: #0f172a !important;
      border-bottom: 1px solid #1e293b !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .modal-title {
      color: #f8fafc !important;
      font-weight: 800 !important;
    }
    html[data-theme="dark"] .close-modal {
      background: #1e293b !important;
      color: #94a3b8 !important;
      border: 1px solid #334155 !important;
      border-radius: 50% !important;
      width: 32px !important;
      height: 32px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    html[data-theme="dark"] .close-modal:hover {
      background: #334155 !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .modal-footer {
      background-color: #090d16 !important;
      border-top: 1px solid #1e293b !important;
    }
    html[data-theme="dark"] .tabs {
      border-bottom-color: #1e293b !important;
    }
    html[data-theme="dark"] .tab {
      color: #94a3b8 !important;
      border-radius: 8px 8px 0 0 !important;
      border-bottom: 2px solid transparent !important;
    }
    html[data-theme="dark"] .tab:hover {
      color: #f8fafc !important;
      background: rgba(255, 255, 255, 0.05) !important;
    }
    html[data-theme="dark"] .tab.active {
      color: #38bdf8 !important;
      border-bottom-color: #38bdf8 !important;
      font-weight: 700 !important;
    }

    /* 表单与输入框全量适配深色模式 */
    html[data-theme="dark"] .form-control,
    html[data-theme="dark"] .memo-input,
    html[data-theme="dark"] textarea,
    html[data-theme="dark"] select,
    html[data-theme="dark"] input[type="text"],
    html[data-theme="dark"] input[type="date"],
    html[data-theme="dark"] input[type="time"],
    html[data-theme="dark"] input[type="month"],
    html[data-theme="dark"] input[type="datetime-local"] {
      background-color: #141b2d !important;
      border: 1.5px solid #28354f !important;
      border-radius: 8px !important;
      color: #f8fafc !important;
      color-scheme: dark !important;
    }
    html[data-theme="dark"] .form-control:focus,
    html[data-theme="dark"] .memo-input:focus,
    html[data-theme="dark"] textarea:focus,
    html[data-theme="dark"] input:focus {
      background-color: #0b0f19 !important;
      border-color: #3b82f6 !important;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.22) !important;
    }
    html[data-theme="dark"] .form-group label {
      color: #cbd5e1 !important;
      font-weight: 600 !important;
    }

    /* 深色模式：功能面板 - 数据管理 (Excel 导出面板深度适配) */
    html[data-theme="dark"] .excel-export-panel {
      background: #141b2d !important;
      border: 1.5px solid #28354f !important;
      border-radius: 14px !important;
    }
    html[data-theme="dark"] .excel-export-panel h4 {
      color: #60a5fa !important;
    }
    html[data-theme="dark"] .excel-export-panel p {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .excel-export-grid > label {
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .excel-export-grid > label input,
    html[data-theme="dark"] .excel-export-grid > label select {
      background: #0f172a !important;
      border: 1.5px solid #28354f !important;
      color: #f8fafc !important;
      color-scheme: dark !important;
    }
    html[data-theme="dark"] .excel-user-picker-heading {
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .excel-selection-count {
      background: rgba(59, 130, 246, 0.2) !important;
      color: #93c5fd !important;
    }
    html[data-theme="dark"] .excel-user-picker {
      background: #0b0f19 !important;
      border: 1.5px solid #1e293b !important;
      border-radius: 10px !important;
    }
    html[data-theme="dark"] .excel-user-option {
      background: #141b2d !important;
      border: 1px solid #28354f !important;
      color: #f1f5f9 !important;
      border-radius: 8px !important;
    }
    html[data-theme="dark"] .excel-user-option:hover {
      border-color: #3b82f6 !important;
      background: #1a233a !important;
    }
    html[data-theme="dark"] .excel-user-option.selected {
      background: rgba(37, 99, 235, 0.25) !important;
      border-color: #3b82f6 !important;
    }
    html[data-theme="dark"] .excel-user-option-name {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .excel-user-option-meta {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .excel-user-picker-empty {
      color: #64748b !important;
    }

    /* 深色模式：功能面板 - 任务发布 (接收人选择器与说明) */
    html[data-theme="dark"] .task-assignee-panel {
      background: #141b2d !important;
      border: 1.5px solid #28354f !important;
      border-radius: 12px !important;
    }
    html[data-theme="dark"] .task-assignee-modes {
      background: #0b0f19 !important;
      border: 1px solid #1e293b !important;
      border-radius: 999px !important;
    }
    html[data-theme="dark"] .task-assignee-mode {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .task-assignee-mode.active {
      background: #2563eb !important;
      color: #ffffff !important;
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35) !important;
    }
    html[data-theme="dark"] .task-assignee-summary {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .assignee-tag {
      background: #0f172a !important;
      border: 1.5px solid #28354f !important;
      color: #e2e8f0 !important;
      border-radius: 999px !important;
    }
    html[data-theme="dark"] .assignee-tag:hover {
      border-color: #3b82f6 !important;
      background: #1a233a !important;
    }
    html[data-theme="dark"] .assignee-tag.selected {
      background: rgba(37, 99, 235, 0.3) !important;
      border-color: #3b82f6 !important;
      color: #93c5fd !important;
    }
    html[data-theme="dark"] .task-publish-info,
    html[data-theme="dark"] .export-info {
      background: #141b2d !important;
      border: 1px solid #28354f !important;
      color: #94a3b8 !important;
      border-radius: 10px !important;
    }
    html[data-theme="dark"] .task-publish-info h4,
    html[data-theme="dark"] .export-info h4 {
      color: #f8fafc !important;
    }

    /* 深色模式：功能面板 - 人员管理 */
    html[data-theme="dark"] .user-management-item {
      background: #141b2d !important;
      border: 1.5px solid #28354f !important;
      border-radius: 12px !important;
    }
    html[data-theme="dark"] .user-field label {
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .user-edit-grid input,
    html[data-theme="dark"] .user-edit-grid select {
      background: #0b0f19 !important;
      border: 1.5px solid #28354f !important;
      color: #f8fafc !important;
      color-scheme: dark !important;
    }
    html[data-theme="dark"] .user-edit-grid input:disabled,
    html[data-theme="dark"] .user-edit-grid select:disabled {
      background: #080c14 !important;
      color: #64748b !important;
      border-color: #1e293b !important;
    }
    html[data-theme="dark"] .user-management-meta {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .user-management-current {
      background: rgba(59, 130, 246, 0.2) !important;
      color: #93c5fd !important;
    }

    /* 深色模式：功能面板 - 运维监控 */
    html[data-theme="dark"] .ops-card {
      background: #141b2d !important;
      border: 1px solid #28354f !important;
      border-radius: 12px !important;
    }
    html[data-theme="dark"] .ops-card-title {
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .ops-card-value {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .ops-card-subtitle {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .ops-section {
      background: #141b2d !important;
      border: 1px solid #28354f !important;
      border-radius: 12px !important;
    }
    html[data-theme="dark"] .ops-section h4 {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .ops-disk-item {
      background: #0f172a !important;
      border: 1px solid #1e293b !important;
      border-radius: 10px !important;
    }
    html[data-theme="dark"] .ops-disk-top {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .ops-progress {
      background: #1e293b !important;
    }
    html[data-theme="dark"] .ops-info-row {
      background: #0f172a !important;
      border: 1px solid #1e293b !important;
      border-radius: 8px !important;
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .ops-info-row strong {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .ops-note-list {
      color: #94a3b8 !important;
    }

    /* 深色模式：备忘录编辑弹窗 Markdown 编辑器 */
    html[data-theme="dark"] .memo-text-editor {
      border: 1.5px solid #28354f !important;
      border-radius: 10px !important;
      background: #0b0f19 !important;
      overflow: hidden !important;
    }
    html[data-theme="dark"] .memo-text-toolbar {
      background: #141b2d !important;
      border-bottom: 1px solid #1e293b !important;
    }
    html[data-theme="dark"] .memo-text-tool {
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .memo-text-tool:hover {
      background: #1e293b !important;
      color: #60a5fa !important;
    }
    html[data-theme="dark"] .memo-text-separator {
      background: #28354f !important;
    }
    html[data-theme="dark"] .memo-text-editor textarea.form-control {
      background: #0b0f19 !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .memo-text-helper {
      background: #141b2d !important;
      border-top: 1px solid #1e293b !important;
      color: #64748b !important;
    }
    html[data-theme="dark"] .markdown-preview {
      background: #0b0f19 !important;
      border: 1.5px solid #28354f !important;
      border-radius: 10px !important;
      color: #e2e8f0 !important;
    }
    html[data-theme="dark"] .markdown-preview h1,
    html[data-theme="dark"] .markdown-preview h2,
    html[data-theme="dark"] .markdown-preview h3 {
      color: #f8fafc !important;
      border-bottom-color: #28354f !important;
    }
    html[data-theme="dark"] .markdown-preview code {
      background: #1e293b !important;
      color: #f472b6 !important;
    }
    html[data-theme="dark"] .markdown-preview pre {
      background: #050810 !important;
      border: 1px solid #1e293b !important;
      color: #f8fafc !important;
    }

    /* 深色模式：每日备忘录详情弹窗 (DailyDetailModal) */
    html[data-theme="dark"] .daily-quick-add-box {
      background-color: #141b2d !important;
      border: 1.5px dashed #28354f !important;
    }
    html[data-theme="dark"] .daily-quick-add-title {
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .daily-quick-memo-input {
      background: #0b0f19 !important;
      border: 1.5px solid #28354f !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .daily-quick-memo-input:focus {
      border-color: #3b82f6 !important;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.22) !important;
    }
    html[data-theme="dark"] #dailyDetailModal .task-item {
      background: #141b2d !important;
      border: 1px solid #28354f !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .data-stats-card {
      background-color: #141b2d !important;
      border: 1px solid #28354f !important;
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .stat-completed {
      color: #34d399 !important;
    }
    html[data-theme="dark"] .stat-pending {
      color: #94a3b8 !important;
    }

    /* 深色模式：提醒中心弹窗 (ReminderModal) */
    html[data-theme="dark"] .reminder-content {
      background: #0f172a !important;
      border: 1px solid #1e293b !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .reminder-body {
      background: #0f172a !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .reminder-section-title {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .reminder-section-title small {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .reminder-item {
      background-color: #141b2d !important;
      border: 1px solid #28354f !important;
      border-left: 4px solid #f59e0b !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .reminder-item:hover {
      background-color: #1a233a !important;
    }
    html[data-theme="dark"] .reminder-item-title {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .reminder-item-details {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .reminder-actions {
      background: #090d16 !important;
      border-top: 1px solid #1e293b !important;
    }
    html[data-theme="dark"] .reminder-settings {
      color: #cbd5e1 !important;
    }

    /* 深色模式：标记完成按钮组件 (重点修复白底暗字异常) */
    html[data-theme="dark"] .memo-title-completed {
      background: #141b2d !important;
      border: 1.5px solid #28354f !important;
      color: #94a3b8 !important;
      border-radius: 8px !important;
      font-weight: 600 !important;
      padding: 8px 14px !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    html[data-theme="dark"] .memo-title-completed:hover {
      background: #1e293b !important;
      border-color: #3b82f6 !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .memo-title-completed.is-completed,
    html[data-theme="dark"] .memo-title-completed:has(input:checked) {
      background: rgba(16, 185, 129, 0.22) !important;
      border-color: #10b981 !important;
      color: #34d399 !important;
      box-shadow: 0 0 14px rgba(16, 185, 129, 0.25) !important;
    }
    html[data-theme="dark"] .memo-title-completed input {
      accent-color: #10b981 !important;
    }

    /* 深色模式：全量按钮组件深度美化 */
    html[data-theme="dark"] .btn {
      border-radius: 8px !important;
      font-weight: 700 !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    html[data-theme="dark"] .btn-primary {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
      color: #ffffff !important;
      border: none !important;
      box-shadow: 0 3px 12px rgba(37, 99, 235, 0.35) !important;
    }
    html[data-theme="dark"] .btn-primary:hover {
      background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 18px rgba(37, 99, 235, 0.5) !important;
    }
    html[data-theme="dark"] .btn-secondary {
      background: #1e293b !important;
      border: 1px solid #334155 !important;
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .btn-secondary:hover {
      background: #334155 !important;
      border-color: #475569 !important;
      color: #ffffff !important;
      transform: translateY(-1px) !important;
    }
    html[data-theme="dark"] .btn-success {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
      color: #ffffff !important;
      border: none !important;
      box-shadow: 0 3px 12px rgba(16, 185, 129, 0.35) !important;
    }
    html[data-theme="dark"] .btn-success:hover {
      background: linear-gradient(135deg, #34d399 0%, #10b981 100%) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 18px rgba(16, 185, 129, 0.5) !important;
    }
    html[data-theme="dark"] .btn-danger {
      background: rgba(239, 68, 68, 0.2) !important;
      border: 1px solid rgba(239, 68, 68, 0.45) !important;
      color: #fca5a5 !important;
      box-shadow: 0 3px 10px rgba(239, 68, 68, 0.2) !important;
    }
    html[data-theme="dark"] .btn-danger:hover {
      background: #ef4444 !important;
      color: #ffffff !important;
      border-color: #ef4444 !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 18px rgba(239, 68, 68, 0.4) !important;
    }
    html[data-theme="dark"] .btn-warning {
      background: rgba(245, 158, 11, 0.2) !important;
      border: 1px solid rgba(245, 158, 11, 0.45) !important;
      color: #fcd34d !important;
      box-shadow: 0 3px 10px rgba(245, 158, 11, 0.2) !important;
    }
    html[data-theme="dark"] .btn-warning:hover {
      background: #f59e0b !important;
      color: #ffffff !important;
      border-color: #f59e0b !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 18px rgba(245, 158, 11, 0.4) !important;
    }
    html[data-theme="dark"] .toolbar-btn-secondary {
      background: #1e293b !important;
      border: 1px solid #334155 !important;
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .toolbar-btn-secondary:hover {
      background: #334155 !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .toolbar-btn-primary {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
      color: #ffffff !important;
      box-shadow: 0 3px 12px rgba(37, 99, 235, 0.35) !important;
      border: none !important;
    }
    html[data-theme="dark"] .toolbar-btn-primary:hover {
      background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 18px rgba(37, 99, 235, 0.5) !important;
    }
    html[data-theme="dark"] .toolbar-btn-success {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
      color: #ffffff !important;
      box-shadow: 0 3px 12px rgba(16, 185, 129, 0.35) !important;
      border: none !important;
    }
    html[data-theme="dark"] .toolbar-btn-success:hover {
      background: linear-gradient(135deg, #34d399 0%, #10b981 100%) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 5px 18px rgba(16, 185, 129, 0.5) !important;
    }
    html[data-theme="dark"] .floating-btn {
      background: #141d33 !important;
      color: #f8fafc !important;
      border: 1.5px solid rgba(255, 255, 255, 0.15) !important;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65), 0 0 15px rgba(59, 130, 246, 0.25) !important;
    }
    html[data-theme="dark"] .floating-btn:hover {
      background: #1e2b48 !important;
      border-color: #3b82f6 !important;
      color: #60a5fa !important;
      transform: translateY(-3px) scale(1.06) !important;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.8), 0 0 20px rgba(59, 130, 246, 0.4) !important;
    }
    html[data-theme="dark"] .complete-all-btn {
      background: linear-gradient(135deg, #10b981, #059669) !important;
      color: #ffffff !important;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35) !important;
    }
    html[data-theme="dark"] .complete-all-btn:hover {
      background: linear-gradient(135deg, #34d399, #10b981) !important;
      box-shadow: 0 6px 16px rgba(16, 185, 129, 0.5) !important;
    }
    html[data-theme="dark"] .task-btn {
      border-radius: 6px !important;
      font-weight: 600 !important;
      padding: 5px 10px !important;
      border: 1px solid transparent !important;
      transition: all 0.2s ease !important;
    }
    html[data-theme="dark"] .task-btn-complete {
      background: rgba(16, 185, 129, 0.2) !important;
      color: #34d399 !important;
      border-color: rgba(16, 185, 129, 0.35) !important;
    }
    html[data-theme="dark"] .task-btn-complete:hover {
      background: #10b981 !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .task-btn-edit {
      background: rgba(59, 130, 246, 0.2) !important;
      color: #60a5fa !important;
      border-color: rgba(59, 130, 246, 0.35) !important;
    }
    html[data-theme="dark"] .task-btn-edit:hover {
      background: #3b82f6 !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .task-btn-delete {
      background: rgba(239, 68, 68, 0.2) !important;
      color: #f87171 !important;
      border-color: rgba(239, 68, 68, 0.35) !important;
    }
    html[data-theme="dark"] .task-btn-delete:hover {
      background: #ef4444 !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .user-save-btn {
      background: rgba(16, 185, 129, 0.2) !important;
      color: #34d399 !important;
      border-color: rgba(16, 185, 129, 0.35) !important;
    }
    html[data-theme="dark"] .user-save-btn:hover {
      background: #10b981 !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .user-delete-btn:disabled {
      background: #1e293b !important;
      color: #475569 !important;
      border: 1px solid #334155 !important;
      opacity: 0.5 !important;
      cursor: not-allowed !important;
    }
    html[data-theme="dark"] .task-item {
      background: #141d33 !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-left-width: 4px !important;
      border-left-style: solid !important;
      border-radius: 12px !important;
      padding: 14px 16px !important;
      margin-bottom: 12px !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35) !important;
      color: #f8fafc !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    html[data-theme="dark"] .task-item:hover {
      background: #1a2744 !important;
      border-color: rgba(255, 255, 255, 0.16) !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5) !important;
    }
    html[data-theme="dark"] .task-title {
      color: #f8fafc !important;
      font-weight: 700 !important;
      font-size: 0.96rem !important;
    }
    html[data-theme="dark"] .task-due {
      color: #94a3b8 !important;
      font-size: 0.82rem !important;
    }
    html[data-theme="dark"] .task-content {
      color: #cbd5e1 !important;
      font-size: 0.88rem !important;
      line-height: 1.55 !important;
    }
    html[data-theme="dark"] .reminder-header {
      background: #0f172a !important;
      border-bottom: 1px solid #1e293b !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .close-reminder {
      background: #1e293b !important;
      color: #94a3b8 !important;
      border: 1px solid #334155 !important;
      border-radius: 50% !important;
      width: 32px !important;
      height: 32px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    html[data-theme="dark"] .close-reminder:hover {
      background: #334155 !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .color-option.selected {
      border: 2px solid #ffffff !important;
      box-shadow: 0 0 0 2px #0f172a, 0 0 10px rgba(255, 255, 255, 0.4) !important;
      transform: scale(1.15) !important;
    }
    html[data-theme="dark"] .clear-search {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .clear-search:hover {
      background-color: rgba(255, 255, 255, 0.1) !important;
      color: #f87171 !important;
    }
    html[data-theme="dark"] .server-session-actions button:last-child {
      background: #1e293b !important;
      border: 1px solid #334155 !important;
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .server-session-actions button:last-child:hover {
      background: #334155 !important;
      color: #ffffff !important;
    }

    /* 深色模式：登录界面（纯静态、零光效、零动效） */
    html[data-theme="dark"] #serverLoginOverlay {
      background: #090d16 !important;
    }
    html[data-theme="dark"] .server-login-container {
      background: #0f172a !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      box-shadow: 0 15px 40px rgba(0, 0, 0, 0.5) !important;
    }
    html[data-theme="dark"] .server-login-brand {
      background: #0f172a !important;
      border-right: 1px solid rgba(255, 255, 255, 0.06) !important;
    }
    html[data-theme="dark"] .server-login-form-area {
      background: #0f172a !important;
    }
    html[data-theme="dark"] .server-auth-header-text h2 {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .server-auth-header-text p {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .server-auth-tabs {
      background: #141b2d !important;
      border: 1px solid #28354f !important;
    }
    html[data-theme="dark"] .server-auth-tabs button {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .server-auth-tabs button.active {
      background: #2563eb !important;
      color: #ffffff !important;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35) !important;
    }
    html[data-theme="dark"] .server-form-field label {
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .server-input-box,
    html[data-theme="dark"] .server-select-box {
      background: #141b2d !important;
      border: 1.5px solid #28354f !important;
      border-radius: 10px !important;
    }
    html[data-theme="dark"] .server-input-box:focus-within,
    html[data-theme="dark"] .server-select-box:focus-within {
      background: #0f172a !important;
      border-color: #3b82f6 !important;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.22) !important;
    }
    html[data-theme="dark"] .server-input-box input,
    html[data-theme="dark"] .server-select-box select {
      background: transparent !important;
      border: 0 !important;
      color: #f8fafc !important;
      outline: none !important;
      box-shadow: none !important;
    }
    html[data-theme="dark"] .server-input-box input:-webkit-autofill,
    html[data-theme="dark"] .server-input-box input:-webkit-autofill:hover,
    html[data-theme="dark"] .server-input-box input:-webkit-autofill:focus,
    html[data-theme="dark"] .server-input-box input:-webkit-autofill:active {
      -webkit-text-fill-color: #f8fafc !important;
      -webkit-box-shadow: 0 0 0 1000px #141b2d inset !important;
      box-shadow: 0 0 0 1000px #141b2d inset !important;
      transition: background-color 5000s ease-in-out 0s !important;
    }
    html[data-theme="dark"] .server-input-icon {
      color: #94a3b8 !important;
      opacity: 0.8 !important;
    }
    html[data-theme="dark"] .server-eye-btn {
      color: #94a3b8 !important;
      opacity: 0.8 !important;
    }
    html[data-theme="dark"] #serverLoginButton,
    html[data-theme="dark"] #serverRegisterButton,
    html[data-theme="dark"] #serverChangePasswordButton {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
      box-shadow: 0 4px 15px rgba(37, 99, 235, 0.35) !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] #serverForgotPwd {
      color: #60a5fa !important;
    }
    html[data-theme="dark"] .server-remember-row {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .server-form-footer {
      border-top-color: #1e293b !important;
      color: #64748b !important;
    }

    @media (max-width: 900px) {
      header.app-topbar {
        flex-wrap: wrap;
        padding: 10px 14px;
        gap: 10px;
      }
      .topbar-left {
        order: 1;
      }
      .topbar-right {
        order: 2;
        margin-left: auto;
      }
      .topbar-nav {
        order: 3;
        width: 100%;
        justify-content: space-between;
      }
      .topbar-nav .current-period {
        flex: 1;
        text-align: center;
      }
      .toolbar.workspace-subbar {
        padding: 10px 12px;
        gap: 10px;
      }
      .search-container {
        width: 100%;
        order: 1;
      }
      .month-count-selector {
        order: 2;
      }
      .toolbar-buttons {
        order: 3;
        width: 100%;
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      .toolbar-btn {
        width: 100%;
        justify-content: center;
      }
    }

    @media (max-width: 840px) {
      #serverLoginOverlay {
        padding: 12px;
        align-items: center;
        overflow-x: hidden;
      }
      .server-login-container {
        grid-template-columns: 1fr;
        max-width: 440px;
        border-radius: 20px;
        box-shadow: 0 15px 35px -5px rgba(0, 0, 0, 0.35);
      }
      .server-login-brand {
        padding: 16px 20px;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
      }
      .server-brand-hero, .server-brand-preview-card, .server-brand-footer {
        display: none !important;
      }
      .server-brand-logo-row {
        gap: 10px;
      }
      .server-brand-logo-icon {
        width: 36px;
        height: 36px;
        font-size: 18px;
        border-radius: 10px;
      }
      .server-brand-app-name {
        font-size: 0.95rem;
      }
      .server-brand-dept {
        display: none;
      }
      .server-login-form-area {
        padding: 24px 20px;
      }
      .server-form-header {
        display: none;
      }
      .server-auth-header-text {
        margin-bottom: 16px;
      }
      .server-auth-header-text h2 {
        font-size: 1.3rem;
      }
      .server-auth-tabs button {
        padding: 9px 2px;
        font-size: 0.8rem;
      }
      .server-input-box input, .server-select-box select {
        font-size: 16px; /* 关键：防止 iOS Safari 聚焦输入框时强制自动放大页面 */
        padding: 10px 10px;
      }
      #serverLoginButton, #serverRegisterButton, #serverChangePasswordButton {
        padding: 12px 16px;
        font-size: 0.9rem;
      }
    }

    @media (max-width: 768px) {
      #serverLoginOverlay {
        overflow-x: hidden;
      }
      /* 手机端日历格：触控放大、日期突出、彩点代替重叠文本 */
      .calendar-day {
        min-height: 56px !important;
        padding: 4px 2px !important;
        border-radius: 8px !important;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.1s ease, background-color 0.1s ease;
      }
      .calendar-day:active {
        background-color: #e2e8f0 !important;
        transform: scale(0.96);
      }
      .calendar-day.today {
        background: rgba(67, 97, 238, 0.08) !important;
        border: 2px solid var(--primary-color) !important;
      }
      .calendar-day.today .day-number {
        background: transparent !important;
        color: var(--primary-color) !important;
        border-radius: 0 !important;
        width: auto !important;
        height: auto !important;
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        box-shadow: none !important;
      }
      .calendar-day .day-number {
        font-size: 0.88rem;
        margin-bottom: 2px;
        align-self: center;
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
        width: 100% !important;
        min-height: auto !important;
      }
      .calendar-day .day-number-text {
        white-space: nowrap !important;
        word-break: keep-all !important;
        text-align: center !important;
        font-weight: 700 !important;
        font-size: 0.88rem !important;
        min-width: 0 !important;
        padding: 0 !important;
        line-height: 1.2 !important;
        flex-shrink: 0 !important;
      }
      .calendar-day .day-number-actions {
        display: none !important;
      }
      .calendar-day .day-add {
        display: none !important;
      }
      .calendar-day .memo-count {
        display: none !important;
      }
      .calendar-day .day-memos {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 3px;
        max-height: 22px;
        overflow: hidden;
        width: 100%;
        padding: 1px;
      }
      .calendar-day .day-memo-item {
        padding: 0 !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        font-size: 0 !important;
        color: transparent !important;
        line-height: 0 !important;
        margin: 0 !important;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        pointer-events: none; /* 让点触事件直接穿透至单元格触发详情 */
      }
      .calendar-day .day-memo-item .memo-color-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        margin: 0;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        flex-shrink: 0;
      }

      /* 每日备忘录弹窗在手机端的友好卡片排版 */
      .task-item {
        padding: 12px 14px;
        border-radius: 12px;
        margin-bottom: 10px;
        background: white;
        border: 1px solid #e2e8f0;
        border-left: 5px solid var(--primary-color);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
      }
      .task-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        flex-wrap: wrap;
      }
      .task-btn {
        padding: 8px 14px;
        font-size: 0.86rem;
        font-weight: 600;
        border-radius: 8px;
        min-height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
      }

      /* 移动端输入框防放大（强制 16px） */
      .search-input,
      .month-count-selector select,
      .topbar-member-selector select,
      #quickMemoTitle {
        font-size: 16px !important;
      }
    }

    @media (max-width: 600px) {
      .app-brand .app-title {
        font-size: 1.05rem;
      }
      .topbar-user-badge {
        font-size: 0.72rem;
        padding: 2px 8px;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .topbar-logout-btn .logout-text {
        display: none;
      }
      .topbar-logout-btn {
        padding: 6px 10px;
      }
      .topbar-member-selector label {
        display: none;
      }
      .topbar-member-selector select {
        max-width: 110px;
        font-size: 12px;
      }
      .toolbar-buttons {
        grid-template-columns: 1fr;
      }
      .floating-actions {
        bottom: 18px;
        right: 18px;
        gap: 10px;
      }
      .floating-btn {
        width: 48px;
        height: 48px;
        font-size: 1.15rem;
      }
    }

    /* 全局弹窗质感动效与毛玻璃遮罩 */
    .modal, .reminder-modal {
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
      transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    .modal.active .modal-content,
    .reminder-modal.active .reminder-content {
      animation: modalFadeIn 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
    }
    @keyframes modalFadeIn {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    /* 人员编辑网格自适应 */
    .user-edit-grid {
      display: grid !important;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) !important;
      gap: 12px !important;
      margin-top: 14px !important;
    }
    @media (max-width: 768px) {
      .user-edit-grid {
        grid-template-columns: 1fr !important;
        gap: 10px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function injectUserBar() {
  const memberSelect = $('serverMemberSelect');
  if (memberSelect && !memberSelect.dataset.bound) {
    memberSelect.dataset.bound = 'true';
    memberSelect.addEventListener('change', (event) => {
      state.selectedUserId = event.target.value;
      renderCustomMemberOptions();
      refreshMemoViews();
    });
  }
  const logoutBtn = $('serverLogout');
  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = 'true';
    logoutBtn.addEventListener('click', logout);
  }
}

function applyRoleScopedUi() {
  const visible = canManageWorkspace();
  ['toolbarPublish', 'toolbarDashboard', 'toolbarImport', 'navDataManagement', 'navSettings', 'floatingFunctions', 'viewRecentTasks'].forEach((id) => setElementVisible(id, visible));
  document.querySelectorAll('.admin-only-tab').forEach((tab) => {
    tab.hidden = state.user?.role !== 'admin';
    tab.style.display = state.user?.role === 'admin' ? '' : 'none';
  });
  setElementVisible('toolbarExport', state.user?.role === 'admin');
  setElementVisible('toolbarMore', visible);

  const toolbarButtons = document.querySelector('.toolbar-buttons');
  let staffExport = $('toolbarStaffExport');
  if (!visible && toolbarButtons && !staffExport) {
    staffExport = document.createElement('button');
    staffExport.id = 'toolbarStaffExport';
    staffExport.type = 'button';
    staffExport.className = 'toolbar-btn toolbar-btn-secondary btn btn-outline-secondary';
    staffExport.innerHTML = '<span class="tabler-icon" data-icon="file-spreadsheet" aria-hidden="true"></span><span>导出月报</span>';
    staffExport.title = '导出我的工作日历记录 (Excel)';
    staffExport.addEventListener('click', exportStaffCalendarExcel);
    toolbarButtons.append(staffExport);
    addTablerIcon(staffExport, 'file-spreadsheet');
  }
  if (staffExport) setElementVisible('toolbarStaffExport', !visible);

  $('toolbarNewMemo')?.classList.toggle('toolbar-btn-full', false);
  if (!visible) state.activeView = 'calendar';
  applyMainView();
  if (toolbarButtons) toolbarButtons.style.display = '';
  if (!visible && $('functionsModal')?.classList.contains('active')) closeFunctionsModal();
}

function applyMainView() {
  const dashboardVisible = canManageWorkspace() && state.activeView === 'dashboard';
  const weeklyPlanVisible = state.activeView === 'weeklyPlan';
  const calendarVisible = !dashboardVisible && !weeklyPlanVisible;

  setElementVisible('dashboardPage', dashboardVisible);
  setElementVisible('weeklyPlanPage', weeklyPlanVisible);

  const calendarContainer = document.querySelector('.calendar-container');
  if (calendarContainer) {
    calendarContainer.hidden = !calendarVisible;
    calendarContainer.style.display = calendarVisible ? '' : 'none';
  }
  setElementVisible('teamLeaderboard', canManageWorkspace() && calendarVisible);

  // 同步侧边栏菜单激活态
  $('navCalendar')?.classList.toggle('active', calendarVisible);
  $('navWeeklyPlan')?.classList.toggle('active', weeklyPlanVisible);
  $('toolbarDashboard')?.classList.toggle('active', dashboardVisible);

  // 同步顶部面包屑导航路径
  const breadcrumb = $('headerBreadcrumb');
  if (breadcrumb) {
    if (weeklyPlanVisible) {
      breadcrumb.innerHTML = '<i class="fas fa-tasks text-primary"></i> <span>周计划与周报</span>';
    } else if (dashboardVisible) {
      breadcrumb.innerHTML = '<i class="fas fa-chart-line text-primary"></i> <span>研发数据大屏</span>';
    } else {
      breadcrumb.innerHTML = '<i class="fas fa-calendar-alt text-primary"></i> <span>工作日历</span>';
    }
  }

  // 成员与月数都是月历筛选项；其他页面使用各自的视图切换。
  setElementVisible('memberSelectWrap', canManageWorkspace() && calendarVisible);
  setElementVisible('monthCountSelectorWrap', calendarVisible);

  // 顶部搜索框场景自适应：仅在日历视图显示，大屏与周计划保持顶部通栏清爽
  const searchWrap = document.querySelector('.header-search');
  if (searchWrap) {
    searchWrap.style.display = calendarVisible ? '' : 'none';
  }

  if (dashboardVisible) renderDashboard();
  if (weeklyPlanVisible) renderWeeklyPlanPage();
}

function openWeeklyPlanPage(refDate) {
  state.activeView = 'weeklyPlan';
  state.weeklyPlanDate = refDate ? new Date(refDate) : new Date(state.currentDate || new Date());
  state.weeklyPlanView = state.weeklyPlanView || 'personal';
  state.weeklyMobileDay = null;
  closeFunctionsModal();
  applyMainView();
  try {
    window.location.hash = 'weekly-plan';
  } catch (e) {}
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function closeWeeklyPlanPage() {
  state.activeView = 'calendar';
  if (window.location.hash === '#weekly-plan') {
    try {
      history.pushState("", document.title, window.location.pathname + window.location.search);
    } catch (e) {}
  }
  renderTeamLeaderboard();
  applyMainView();
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function openDashboardPage() {
  if (!canManageWorkspace()) return;
  state.activeView = 'dashboard';
  closeFunctionsModal();
  applyMainView();
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function closeDashboardPage() {
  state.activeView = 'calendar';
  renderTeamLeaderboard();
  applyMainView();
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function resolveEffectiveTheme(preference = state.themePreference) {
  if (preference === 'dark' || preference === 'light') return preference;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

function themeToggleIconClass(pref, mode) {
  if (pref === 'light') return 'fas fa-sun';
  if (pref === 'dark') return 'fas fa-moon';
  return 'fas fa-desktop';
}

function themeToggleLabelText(pref) {
  if (pref === 'light') return '浅色模式';
  if (pref === 'dark') return '深色模式';
  return '跟随系统';
}

function applyTheme(preference) {
  const pref = (preference === 'system' || preference === 'dark' || preference === 'light')
    ? preference
    : (localStorage.getItem('appThemePreference') || 'system');
  state.themePreference = pref;
  localStorage.setItem('appThemePreference', pref);

  const effectiveTheme = resolveEffectiveTheme(pref);
  state.themeMode = effectiveTheme;
  localStorage.setItem('appThemeMode', effectiveTheme);
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  document.documentElement.setAttribute('data-bs-theme', effectiveTheme);
  document.documentElement.setAttribute('data-theme-preference', pref);
  document.documentElement.classList.toggle('dark', effectiveTheme === 'dark');
  document.documentElement.classList.toggle('light', effectiveTheme === 'light');
  document.documentElement.style.colorScheme = effectiveTheme;
  if (document.body) document.body.style.colorScheme = effectiveTheme;
  const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
  if (colorSchemeMeta) colorSchemeMeta.content = effectiveTheme;
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) metaThemeColor.content = effectiveTheme === 'dark' ? '#182433' : '#ffffff';

  const isDark = effectiveTheme === 'dark';
  const iconClass = themeToggleIconClass(pref, effectiveTheme);
  const labelText = themeToggleLabelText(pref);

  let titleText = `当前：跟随系统 [${isDark ? '深色' : '浅色'}] (点击切换为浅色)`;
  if (pref === 'light') {
    titleText = '当前：浅色模式 (点击切换为深色)';
  } else if (pref === 'dark') {
    titleText = '当前：深色模式 (点击切换为跟随系统)';
  }

  const topbarBtn = $('themeToggleBtn');
  if (topbarBtn) {
    topbarBtn.innerHTML = `<i class="${iconClass}"></i><span class="nav-label">${labelText}</span>`;
    topbarBtn.title = titleText;
    topbarBtn.blur();
  }
  const loginBtn = $('loginThemeToggle');
  if (loginBtn) {
    loginBtn.innerHTML = `<i class="${iconClass}"></i> <span class="login-theme-label">${labelText}</span>`;
    loginBtn.title = titleText;
  }

}

function toggleTheme() {
  let nextPref = 'dark';
  if (state.themePreference === 'dark') {
    nextPref = 'system';
  } else if (state.themePreference === 'system') {
    nextPref = 'light';
  } else {
    nextPref = 'dark';
  }
  applyTheme(nextPref);
}

function resetMemoSnapshot() {
  state.memoRequestVersion += 1;
  state.reminderRequestVersion += 1;
  state.memoDetailRequestVersion += 1;
  state.memoRequestController?.abort();
  state.weeklyRequestVersion += 1;
  state.weeklyRequestController?.abort();
  state.weeklyRequestController = null;
  state.weeklyMemos = [];
  state.weeklySummaries = [];
  state.weeklyDataRangeKey = '';
  state.weeklyDataLoadingKey = '';
  state.weeklyDataErrorKey = '';
  state.weeklyDataError = '';
  state.weeklySummaryDrafts = {};
  state.memoRequestController = null;
  state.selectedMemoId = null;
  state.memos = [];
  state.reminders = [];
  state.reminderError = '';
  state.memoEtag = '';
  state.memoRangeKey = '';
}

function beginSession(user) {
  state.sessionVersion += 1;
  state.initialLoadSessionVersion = null;
  stopRealtimeRefresh();
  resetMemoSnapshot();
  state.user = user;
  state.users = [];
  state.opsStatus = null;
  return state.sessionVersion;
}

function isCurrentSession(sessionVersion) {
  return Boolean(state.token && state.user && sessionVersion === state.sessionVersion);
}

function setAuthBusy(busy, message = '') {
  document.querySelectorAll('#serverLoginOverlay input, #serverLoginOverlay select, #serverLoginOverlay button').forEach((element) => {
    element.disabled = busy;
  });
  if ($('serverLoginError')) $('serverLoginError').textContent = message;
}

function showAppLoadFailure(error) {
  hideLoginOverlay();
  showSessionOverlay(`日历加载失败：${error.message}`, { error: true });
}

async function retryAppStart() {
  if (!state.token || !state.user) return;
  hideLoginOverlay();
  resetSessionProgress();
  showSessionOverlay('正在重新加载日历…', { percent: 12 });
  const sessionVersion = beginSession(state.user);
  try {
    await startApp(sessionVersion);
  } catch (error) {
    if (isCurrentSession(sessionVersion)) showAppLoadFailure(error);
  }
}

async function login() {
  const username = $('serverLoginUser').value.trim();
  const password = $('serverLoginPass').value;
  let sessionVersion = null;
  setAuthBusy(true, '正在验证账号…');

  try {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    state.token = data.token;
    localStorage.setItem('calendarToken', state.token);
    updateSavedLogin(username, password);
    hideLoginOverlay();
    resetSessionProgress();
    showSessionOverlay('正在加载日历…', { percent: 15 });
    sessionVersion = beginSession(data.user);
    await startApp(sessionVersion);
  } catch (error) {
    if (sessionVersion && isCurrentSession(sessionVersion)) showAppLoadFailure(error);
    else {
      hideSessionOverlay();
      showLoginOverlay(error.message);
      setAuthBusy(false, error.message);
    }
  }
}

async function registerAccount() {
  const displayName = $('serverRegisterName').value.trim();
  const username = displayName;
  const password = $('serverRegisterPass').value;
  const jobTitle = $('serverRegisterRole').value;
  let sessionVersion = null;
  setAuthBusy(true, '正在注册账号…');

  try {
    const data = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName, jobTitle })
    });
    state.token = data.token;
    localStorage.setItem('calendarToken', state.token);
    localStorage.setItem(savedLoginKey, JSON.stringify({ username, password }));
    hideLoginOverlay();
    resetSessionProgress();
    showSessionOverlay('正在加载日历…', { percent: 15 });
    sessionVersion = beginSession(data.user);
    await startApp(sessionVersion);
  } catch (error) {
    if (sessionVersion && isCurrentSession(sessionVersion)) showAppLoadFailure(error);
    else {
      hideSessionOverlay();
      showLoginOverlay(error.message);
      activateAuthPanel('register');
      setAuthBusy(false, error.message);
    }
  }
}

async function changePasswordFromLogin() {
  const username = $('serverPasswordUser').value.trim();
  const oldPassword = $('serverOldPassword').value;
  const newPassword = $('serverNewPassword').value;
  const confirmPassword = $('serverConfirmPassword').value;

  if (!username || !oldPassword || !newPassword || !confirmPassword) {
    $('serverLoginError').textContent = '请完整填写用户名、原密码和新密码';
    return;
  }

  if (newPassword !== confirmPassword) {
    $('serverLoginError').textContent = '两次输入的新密码不一致';
    return;
  }

  try {
    await request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ username, oldPassword, newPassword })
    });
    const savedLogin = readSavedLogin();
    if (savedLogin.username === username) {
      localStorage.setItem(savedLoginKey, JSON.stringify({ username, password: newPassword }));
      if ($('serverRememberLogin')) $('serverRememberLogin').checked = true;
    }
    $('serverLoginUser').value = username;
    $('serverLoginPass').value = savedLogin.username === username ? newPassword : '';
    $('serverOldPassword').value = '';
    $('serverNewPassword').value = '';
    $('serverConfirmPassword').value = '';
    activateAuthPanel('login');
    $('serverLoginError').textContent = '密码已修改，请使用新密码登录';
  } catch (error) {
    activateAuthPanel('password');
    $('serverLoginError').textContent = error.message;
  }
}

async function restoreSession() {
  applyTheme(state.themePreference);
  if (!state.token) {
    showLoginOverlay();
    return;
  }

  let sessionVersion = null;
  resetSessionProgress();
  showSessionOverlay('正在恢复登录状态…', { percent: 10 });
  try {
    const data = await request('/auth/me');
    sessionVersion = beginSession(data.user);
    updateSessionProgress(25, '正在验证身份信息…');
    await startApp(sessionVersion);
  } catch (error) {
    if (sessionVersion && isCurrentSession(sessionVersion)) {
      showAppLoadFailure(error);
      return;
    }
    localStorage.removeItem('calendarToken');
    state.token = '';
    state.user = null;
    resetMemoSnapshot();
    hideSessionOverlay();
    showLoginOverlay('登录状态已失效，请重新登录');
    setAuthBusy(false, '登录状态已失效，请重新登录');
  }
}

function showWorkspaceFromTop() {
  if (window.innerWidth > 768) return;
  const toTop = () => window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  toTop();
  window.requestAnimationFrame(toTop);
}

function resetSessionViewState() {
  state.currentDate = new Date();
  state.selectedUserId = canManageWorkspace() ? 'all' : String(state.user?.id || '');
  state.calendarStatusFilter = 'all';
  state.activeView = 'calendar';
  state.selectedAgendaDate = dateKey(new Date());
  state.opsStatus = null;
  const searchInput = $('searchInput');
  if (searchInput) searchInput.value = '';
  if ($('clearSearch')) $('clearSearch').style.display = 'none';
}

async function startApp(sessionVersion = state.sessionVersion) {
  if (!isCurrentSession(sessionVersion)) return false;
  updateSessionProgress(32, '正在初始化工作区环境…');
  injectUserBar();
  resetSessionViewState();
  $('serverUserName').textContent = state.user.displayName;
  $('serverUserRole').textContent = `· ${displayUserRole(state.user)} · ${state.user.departmentName}`;
  const avatarEl = $('sidebarUserAvatar');
  if (avatarEl && state.user?.displayName) {
    avatarEl.textContent = state.user.displayName.trim().charAt(0) || '用';
  }
  applyRoleScopedUi();
  updateSessionProgress(50, '正在同步团队人员列表…');
  await loadUsers(sessionVersion);
  if (!isCurrentSession(sessionVersion)) return false;
  updateSessionProgress(72, '正在拉取工作日历事项…');
  const initialSnapshotLoaded = await loadMemos({ force: true, sessionVersion });
  if (!isCurrentSession(sessionVersion)) return false;
  if (!initialSnapshotLoaded || state.memoRangeKey !== currentMemoRangeKey()) {
    throw new Error('首次日历数据未完成加载');
  }
  updateSessionProgress(90, '正在校验待办与提醒…');
  await loadReminders(sessionVersion);
  updateSessionProgress(94, '正在准备界面样式…');
  await waitForWorkspaceStyles();
  if (!isCurrentSession(sessionVersion)) return false;
  state.initialLoadSessionVersion = sessionVersion;
  startRealtimeRefresh();
  updateSessionProgress(100, '加载完成，正在呈现工作台…');
  await new Promise(r => setTimeout(r, 260));
  hideLoginOverlay();
  hideSessionOverlay();
  showWorkspaceFromTop();
  return true;
}

function logout() {
  state.sessionVersion += 1;
  stopRealtimeRefresh();
  resetMemoSnapshot();
  state.token = '';
  state.user = null;
  state.users = [];
  state.opsStatus = null;
  localStorage.removeItem('calendarToken');
  hideSessionOverlay();
  resetSessionProgress();
  showLoginOverlay();
  setAuthBusy(false);
}

async function loadUsers(sessionVersion = state.sessionVersion) {
  if (!canManageWorkspace()) {
    if (!isCurrentSession(sessionVersion)) return false;
    state.users = state.user ? [state.user] : [];
    state.selectedUserId = String(state.user?.id || '');
    renderMemberSelect();
    return true;
  }

  const data = await request('/users');
  if (!isCurrentSession(sessionVersion)) return false;
  state.users = data.users;
  if (state.selectedUserId !== 'all' && !state.users.some((user) => String(user.id) === String(state.selectedUserId))) {
    state.selectedUserId = 'all';
  }
  renderMemberSelect();
  return true;
}

function renderMemberSelect() {
  const select = $('serverMemberSelect');
  const options = [];
  if (canManageWorkspace()) options.push('<option value="all">全部成员</option>');
  options.push(...state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.displayName)}（${escapeHtml(displayUserRole(user))}）</option>`));
  select.innerHTML = options.join('');
  select.value = state.selectedUserId;
  renderCustomMemberOptions();
}

function taskAssigneeCandidates() {
  return state.users.filter((user) => Number(user.id) !== Number(state.user?.id));
}

function normalizeTaskAssignees(candidates = taskAssigneeCandidates()) {
  const validIds = candidates.map((user) => Number(user.id));
  const validSet = new Set(validIds);
  state.taskAssigneeIds = state.taskAssigneeIds.map(Number).filter((id) => validSet.has(id));

  if (!state.taskAssigneeIds.length && validIds.length) {
    state.taskAssigneeIds = [validIds[0]];
  }

  if (state.taskAssigneeMode === 'single' && state.taskAssigneeIds.length > 1) {
    state.taskAssigneeIds = [state.taskAssigneeIds[0]];
  }
}

function selectAllTaskAssignees() {
  state.taskAssigneeMode = 'multi';
  const candidates = taskAssigneeCandidates();
  state.taskAssigneeIds = candidates.map((u) => Number(u.id));
  renderTaskAssignees();
}

function clearTaskAssignees() {
  state.taskAssigneeIds = [];
  renderTaskAssignees();
}

function renderTaskAssignees() {
  const box = $('taskAssigneeTags');
  if (!box) return;
  const candidates = taskAssigneeCandidates();
  normalizeTaskAssignees(candidates);
  const selectedSet = new Set(state.taskAssigneeIds.map(Number));
  document.querySelectorAll('.task-assignee-mode').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.taskAssigneeMode);
  });
  const summary = $('taskAssigneeSummary');
  if (summary) summary.textContent = candidates.length ? `已选择 ${state.taskAssigneeIds.length} / ${candidates.length} 人` : '暂无可分配人员';
  box.innerHTML = candidates.length
    ? candidates.map((user) => {
      const selected = selectedSet.has(Number(user.id));
      return `
        <button class="assignee-tag ${selected ? 'selected' : ''}" type="button" data-user-id="${user.id}">
          <span class="assignee-tag-name">${escapeHtml(user.displayName)}</span>
          <span class="assignee-tag-role">${escapeHtml(displayUserRole(user))}</span>
        </button>
      `;
    }).join('')
    : '<div class="assignee-empty">暂无可分配人员</div>';
}

function setTaskAssigneeMode(mode) {
  state.taskAssigneeMode = mode === 'single' ? 'single' : 'multi';
  normalizeTaskAssignees();
  renderTaskAssignees();
}

function toggleTaskAssignee(userId) {
  const id = Number(userId);
  if (!id) return;
  if (state.taskAssigneeMode === 'single') {
    state.taskAssigneeIds = [id];
    renderTaskAssignees();
    return;
  }
  const selectedSet = new Set(state.taskAssigneeIds.map(Number));
  if (selectedSet.has(id)) selectedSet.delete(id);
  else selectedSet.add(id);
  state.taskAssigneeIds = Array.from(selectedSet);
  renderTaskAssignees();
}

function selectedTaskAssigneeIds() {
  normalizeTaskAssignees();
  return state.taskAssigneeIds.map(Number).filter(Boolean);
}

function visibleMonths() {
  return Array.from({ length: state.monthsToShow }, (_, index) => {
    const date = new Date(state.currentDate);
    date.setDate(1);
    date.setMonth(date.getMonth() + index);
    return date;
  });
}

function currentMemoRange() {
  const firstMonth = visibleMonths()[0] || new Date();
  return { startMonth: monthKey(firstMonth), months: state.monthsToShow };
}

function currentMemoRangeKey() {
  const { startMonth, months } = currentMemoRange();
  return `${startMonth}:${months}`;
}

function memoQueryParams() {
  const { startMonth, months } = currentMemoRange();
  return new URLSearchParams({
    startMonth,
    months: String(months),
    userId: canManageWorkspace() ? 'all' : String(state.user?.id || '')
  });
}

async function loadMemos({ force = false, sessionVersion = state.sessionVersion } = {}) {
  if (!isCurrentSession(sessionVersion)) return false;

  const rangeKey = currentMemoRangeKey();
  const requestVersion = ++state.memoRequestVersion;
  state.memoRequestController?.abort();
  const controller = new AbortController();
  state.memoRequestController = controller;
  const headers = !force && state.memoRangeKey === rangeKey && state.memoEtag
    ? { 'If-None-Match': state.memoEtag }
    : {};

  try {
    const data = await request(`/memos?${memoQueryParams().toString()}`, {
      headers,
      signal: controller.signal
    });
    if (!isCurrentSession(sessionVersion) || requestVersion !== state.memoRequestVersion) return false;

    if (data.notModified) return false;
    if (!Array.isArray(data.memos)) throw new Error('日历数据格式无效');
    state.memos = sortMemosForCalendar(data.memos);
    state.memoEtag = data.etag || '';
    state.memoRangeKey = rangeKey;
    refreshMemoViews();
    return true;
  } catch (error) {
    if (error.name === 'AbortError') return false;
    throw error;
  } finally {
    if (state.memoRequestController === controller) state.memoRequestController = null;
  }
}

async function loadReminders(sessionVersion = state.sessionVersion) {
  if (!isCurrentSession(sessionVersion)) return false;
  const requestVersion = ++state.reminderRequestVersion;
  try {
    const data = await request('/memos/reminders');
    if (!isCurrentSession(sessionVersion) || requestVersion !== state.reminderRequestVersion) return false;
    if (!Array.isArray(data.memos)) throw new Error('提醒数据格式无效');
    state.reminders = data.memos;
    state.reminderError = '';
  } catch (error) {
    if (!isCurrentSession(sessionVersion) || requestVersion !== state.reminderRequestVersion) return false;
    state.reminderError = error.message || '提醒读取失败';
  }
  updateReminderBadge();
  if ($('reminderModal')?.classList.contains('active')) renderReminderList();
  if (state.user?.role !== 'admin') checkEngineerNotifications();
  return !state.reminderError;
}

function refreshMemoViews() {
  renderMultiMonthCalendar();
  renderMobileAgenda();
  renderTeamLeaderboard();
  applyMainView();
  updateStats();
  updateReminderBadge();
  if (state.activeView === 'weeklyPlan') renderWeeklyPlanPage();
  if ($('reminderModal')?.classList.contains('active')) showReminderModal();
  if ($('dailyDetailModal')?.classList.contains('active')) loadDailyDetailMemos(state.dailyDetailDate);
}

function memoInVisibleMonths(memo) {
  const memoMonth = String(memo?.date || '').slice(0, 7);
  if (!memoMonth) return false;
  return visibleMonths().some((date) => monthKey(date) === memoMonth);
}

function sortMemosForCalendar(memos) {
  return [...memos].sort((a, b) => (
    String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.ownerName || '').localeCompare(String(b.ownerName || ''), 'zh-CN')
    || Number(a.id || 0) - Number(b.id || 0)
  ));
}

function upsertMemos(list, memos, shouldInclude) {
  const byId = new Map(list.map((memo) => [String(memo.id), memo]));
  for (const memo of memos) {
    if (!memo?.id) continue;
    const id = String(memo.id);
    if (shouldInclude(memo)) byId.set(id, memo);
    else byId.delete(id);
  }
  return sortMemosForCalendar(Array.from(byId.values()));
}

function summarizeMemo(memo) {
  const { content, ...summary } = memo || {};
  const source = String(content ?? summary.contentPreview ?? '');
  return {
    ...summary,
    contentPreview: String(summary.contentPreview ?? source.slice(0, 320)),
    contentLength: Number(summary.contentLength ?? source.length)
  };
}

function syncMemosLocally(memos) {
  const updates = (Array.isArray(memos) ? memos : [memos])
    .filter((memo) => memo?.id)
    .map(summarizeMemo);
  if (!updates.length) return false;

  state.memos = upsertMemos(state.memos, updates, memoInVisibleMonths);
  if (state.weeklyDataRangeKey) {
    const { monday, nextSunday } = getWeekRange(state.weeklyPlanDate);
    const start = dateKey(monday);
    const end = dateKey(nextSunday);
    state.weeklyMemos = upsertMemos(state.weeklyMemos, updates,
      (memo) => memo.date >= start && memo.date <= end);
  }
  state.memoEtag = '';
  refreshMemoViews();
  return true;
}

function removeMemosLocally(memoIds) {
  const ids = new Set((Array.isArray(memoIds) ? memoIds : [memoIds]).map(String));
  if (!ids.size) return;
  state.memos = state.memos.filter((memo) => !ids.has(String(memo.id)));
  state.weeklyMemos = state.weeklyMemos.filter((memo) => !ids.has(String(memo.id)));
  state.memoEtag = '';
  refreshMemoViews();
  void loadReminders();
}

async function syncMemoMutationOrReload(payload) {
  if (!syncMemosLocally(payload?.memo || payload?.memos || [])) {
    await loadMemos({ force: true });
  }
  await loadReminders();
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, consume));
  return results;
}

function canRealtimeRefresh() {
  return Boolean(
    state.token
    && state.initialLoadSessionVersion === state.sessionVersion
    && !document.hidden
    && !$('memoModal')?.classList.contains('active')
    && !$('functionsModal')?.classList.contains('active')
    && !(state.activeView === 'weeklyPlan'
      && document.activeElement?.closest('.wp-summary-panel, .wp-day-quick-add'))
  );
}

async function refreshMemosInBackground() {
  if (!canRealtimeRefresh() || state.realtimeRefreshBusy) return;
  state.realtimeRefreshBusy = true;
  try {
    await loadMemos();
    if (state.activeView === 'weeklyPlan') await loadWeeklyPlanData({ force: true, silent: true });
    await loadReminders();
  } catch (error) {
    console.warn('实时刷新失败', error);
  } finally {
    state.realtimeRefreshBusy = false;
  }
}

function startRealtimeRefresh() {
  stopRealtimeRefresh();
  state.realtimeRefreshTimer = window.setInterval(refreshMemosInBackground, 15000);
}

async function shiftVisibleMonth(delta) {
  const current = state.currentDate;
  state.currentDate = new Date(current.getFullYear(), current.getMonth() + delta, 1);
  await loadMemos();
}

function stopRealtimeRefresh() {
  if (state.realtimeRefreshTimer) window.clearInterval(state.realtimeRefreshTimer);
  state.realtimeRefreshTimer = null;
  state.realtimeRefreshBusy = false;
}

function getVisibleMemos() {
  const searchTerm = ($('searchInput')?.value || '').trim().toLowerCase();
  return state.memos.filter((memo) => {
    if (state.selectedUserId !== 'all' && String(memo.ownerId) !== String(state.selectedUserId)) return false;
    if (!searchTerm) return true;
    return [memo.title, memo.contentPreview, memo.ownerName, memo.departmentName]
      .some((value) => String(value || '').toLowerCase().includes(searchTerm));
  });
}

function getCalendarMemos() {
  const memos = getVisibleMemos();
  if (state.calendarStatusFilter === 'completed') return memos.filter((memo) => memo.completed);
  if (state.calendarStatusFilter === 'pending') return memos.filter((memo) => !memo.completed);
  return memos;
}

function setCalendarStatusFilter(filter) {
  state.calendarStatusFilter = ['completed', 'pending'].includes(filter) ? filter : 'all';
  renderMultiMonthCalendar();
  renderMobileAgenda();
}

function latestMemoColor() {
  return [...state.memos]
    .filter((memo) => memo.color)
    .sort((a, b) => {
      const timeDiff = new Date(b.updatedAt || b.createdAt || b.date) - new Date(a.updatedAt || a.createdAt || a.date);
      return timeDiff || Number(b.id || 0) - Number(a.id || 0);
    })[0]?.color || '';
}

function renderMultiMonthCalendar() {
  const container = $('multiMonthCalendar');
  const periodDisplay = $('currentPeriod');
  const months = visibleMonths();
  container.className = `multi-month-calendar ${state.monthsToShow === 1 ? 'grid-1' : 'grid-2'}`;
  document.querySelector('.container')?.classList.toggle('single-month', state.monthsToShow === 1);
  const startMonth = months[0];
  const endMonth = months[months.length - 1];
  periodDisplay.textContent = state.monthsToShow === 1
    ? `${startMonth.getFullYear()}年${startMonth.getMonth() + 1}月`
    : `${startMonth.getFullYear()}年${startMonth.getMonth() + 1}月 - ${endMonth.getFullYear()}年${endMonth.getMonth() + 1}月`;
  container.innerHTML = months.map((monthDate, index) => createMonthCalendar(monthDate, index)).join('');
}

function renderMobileAgenda() {
  const agenda = $('mobileAgenda');
  if (!agenda) return;
  const months = visibleMonths();
  if (!months.some((month) => monthKey(month) === state.selectedAgendaDate.slice(0, 7))) {
    state.selectedAgendaDate = dateKey(new Date(months[0].getFullYear(), months[0].getMonth(), 1));
  }
  const selected = state.selectedAgendaDate;
  const [year, month, day] = selected.split('-').map(Number);
  const label = `${year}年${month}月${day}日`;
  const items = getCalendarMemos().filter((memo) => memo.date === selected);
  agenda.innerHTML = `
    <div class="mobile-agenda-header">
      <div><span class="mobile-agenda-kicker">当天事项</span><strong>${label}</strong><span class="mobile-agenda-count">${items.length} 条</span></div>
      <button class="btn btn-primary" id="mobileAgendaAdd" type="button">新建备忘录</button>
    </div>
    <div class="mobile-agenda-list">
      ${items.length ? items.map((memo) => `
        <button class="mobile-agenda-item ${memo.completed ? 'completed' : ''}" data-memo-id="${memo.id}" type="button">
          <span class="mobile-agenda-dot" style="background:${escapeHtml(memo.color || colors[0])}"></span>
          <span class="mobile-agenda-item-text"><strong>${escapeHtml(memo.title || '无标题')}</strong>${memo.ownerName && canManageWorkspace() ? `<small>${escapeHtml(memo.ownerName)}</small>` : ''}</span>
        </button>`).join('') : `
        <div class="mobile-agenda-empty">
          <div class="empty-icon"><i class="far fa-calendar-check"></i></div>
          <div class="empty-title">当天暂无待办事项</div>
          <div class="empty-sub">点击右上角“新建备忘录”添加日程</div>
        </div>`}
    </div>`;
  document.querySelectorAll('.calendar-day[data-date]').forEach((cell) => {
    cell.classList.toggle('agenda-selected', cell.dataset.date === selected);
  });
}

function leaderboardPeriodText() {
  const months = visibleMonths();
  const startMonth = months[0];
  const endMonth = months[months.length - 1];
  if (!startMonth || !endMonth) return '';
  return state.monthsToShow === 1
    ? `${startMonth.getFullYear()}年${startMonth.getMonth() + 1}月`
    : `${startMonth.getFullYear()}年${startMonth.getMonth() + 1}月 - ${endMonth.getFullYear()}年${endMonth.getMonth() + 1}月`;
}

function leaderboardRows() {
  const byUser = new Map(state.users.map((user) => [Number(user.id), {
    user,
    total: 0,
    completed: 0,
    pending: 0,
    rate: 0
  }]));

  for (const memo of state.memos) {
    const ownerId = Number(memo.ownerId);
    if (!byUser.has(ownerId)) continue;
    const row = byUser.get(ownerId);
    row.total += 1;
    if (memo.completed) row.completed += 1;
    else row.pending += 1;
  }

  return Array.from(byUser.values())
    .filter((row) => row.total > 0)
    .map((row) => ({ ...row, rate: Math.round((row.completed / row.total) * 100) }))
    .sort((a, b) => b.rate - a.rate || b.completed - a.completed || a.pending - b.pending || a.user.displayName.localeCompare(b.user.displayName, 'zh-CN'));
}

function visiblePeriodRange() {
  const months = visibleMonths();
  const first = months[0] || new Date();
  const last = months[months.length - 1] || first;
  return {
    start: new Date(first.getFullYear(), first.getMonth(), 1),
    end: new Date(last.getFullYear(), last.getMonth() + 1, 0, 23, 59, 59, 999)
  };
}

function dashboardMemos() {
  return canManageWorkspace() ? state.memos : [];
}

function memoDateObject(memo) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(memo.date || ''));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function memoDeadlineDate(memo) {
  if (memo.dueTime) {
    const due = new Date(memo.dueTime);
    if (!Number.isNaN(due.getTime())) return due;
  }
  const date = memoDateObject(memo);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function memoUpdatedDate(memo) {
  const updated = new Date(memo.updatedAt || memo.createdAt || memo.date);
  return Number.isNaN(updated.getTime()) ? memoDateObject(memo) : updated;
}

function isOverdueMemo(memo, now = new Date()) {
  const deadline = memoDeadlineDate(memo);
  return Boolean(deadline && !memo.completed && deadline < now);
}

function isDueSoonMemo(memo, now = new Date()) {
  const deadline = memoDeadlineDate(memo);
  if (!deadline || memo.completed || deadline < now) return false;
  return deadline.getTime() - now.getTime() <= 3 * 24 * 60 * 60 * 1000;
}

function isStaleMemo(memo, now = new Date()) {
  const updated = memoUpdatedDate(memo);
  if (!updated || memo.completed) return false;
  return now.getTime() - updated.getTime() > 7 * 24 * 60 * 60 * 1000;
}

function dashboardUserRows() {
  const now = new Date();
  const byUser = new Map(state.users.map((user) => [Number(user.id), {
    user,
    total: 0,
    completed: 0,
    pending: 0,
    overdue: 0,
    dueSoon: 0,
    stale: 0,
    rate: 0
  }]));

  for (const memo of dashboardMemos()) {
    const row = byUser.get(Number(memo.ownerId));
    if (!row) continue;
    row.total += 1;
    if (memo.completed) row.completed += 1;
    else row.pending += 1;
    if (isOverdueMemo(memo, now)) row.overdue += 1;
    else if (isDueSoonMemo(memo, now)) row.dueSoon += 1;
    if (isStaleMemo(memo, now)) row.stale += 1;
  }

  return Array.from(byUser.values())
    .filter((row) => row.total > 0)
    .map((row) => ({ ...row, rate: row.total ? Math.round((row.completed / row.total) * 100) : 0 }))
    .sort((a, b) => b.overdue - a.overdue || b.pending - a.pending || b.dueSoon - a.dueSoon || a.rate - b.rate || a.user.displayName.localeCompare(b.user.displayName, 'zh-CN'));
}

function dashboardSummary() {
  const now = new Date();
  const memos = dashboardMemos();
  const total = memos.length;
  const completed = memos.filter((memo) => memo.completed).length;
  const pending = total - completed;
  const overdue = memos.filter((memo) => isOverdueMemo(memo, now)).length;
  const dueSoon = memos.filter((memo) => isDueSoonMemo(memo, now)).length;
  const stale = memos.filter((memo) => isStaleMemo(memo, now)).length;
  const today = dateKey(now);
  const todayTotal = memos.filter((memo) => memo.date === today).length;
  const todayCompleted = memos.filter((memo) => memo.date === today && memo.completed).length;
  return {
    total,
    completed,
    pending,
    overdue,
    dueSoon,
    stale,
    todayTotal,
    todayCompleted,
    rate: total ? Math.round((completed / total) * 100) : 0,
    activeUsers: dashboardUserRows().length
  };
}

function renderDashboardMetrics(summary) {
  const metrics = $('dashboardMetrics');
  if (!metrics) return;
  const cards = [
    { label: '总任务', value: summary.total, sub: `${summary.activeUsers} 人有分配任务`, icon: 'fas fa-layer-group', tone: 'total' },
    { label: '已完成', value: summary.completed, sub: `完成率 ${summary.rate}%`, icon: 'fas fa-check-circle', tone: 'success' },
    { label: '未完成', value: summary.pending, sub: '仍需推进完成', icon: 'fas fa-hourglass-half', tone: 'pending' },
    { label: '逾期任务', value: summary.overdue, sub: summary.overdue ? '严重阻塞，需优先处理' : '无逾期风险', icon: 'fas fa-exclamation-triangle', tone: summary.overdue ? 'danger' : 'safe' },
    { label: '临近截止', value: summary.dueSoon, sub: summary.dueSoon ? '3天内即将到期' : '近期无临期', icon: 'far fa-clock', tone: summary.dueSoon ? 'warning' : 'safe' },
    { label: '今日进度', value: `${summary.todayCompleted} / ${summary.todayTotal}`, sub: '今日任务完成数', icon: 'fas fa-calendar-check', tone: 'today' }
  ];
  metrics.innerHTML = cards.map((card) => `
    <div class="dashboard-metric metric-${card.tone}">
      <div class="dashboard-metric-top">
        <span class="dashboard-metric-icon"><i class="${card.icon}"></i></span>
        <span class="dashboard-metric-label">${escapeHtml(card.label)}</span>
      </div>
      <div class="dashboard-metric-value">${escapeHtml(card.value)}</div>
      <div class="dashboard-metric-sub">
        <span class="dashboard-metric-dot"></span>
        <span>${escapeHtml(card.sub)}</span>
      </div>
    </div>
  `).join('');
}

function renderDashboardUserLoad(rows) {
  const box = $('dashboardUserLoad');
  if (!box) return;
  box.innerHTML = rows.length
    ? rows.map((row) => {
      const isComplete = row.total > 0 && row.completed === row.total;
      const hasOverdue = row.overdue > 0;
      const initial = (row.user.displayName || '用').trim().charAt(0);
      return `
      <div class="dashboard-user-row ${isComplete ? 'is-complete' : ''} ${hasOverdue ? 'has-overdue' : ''}" data-dashboard-user-id="${row.user.id}" title="点击查看 ${escapeHtml(row.user.displayName)} 的工作日历" style="--dashboard-rate:${row.rate}%">
        <div class="user-row-profile">
          <div class="user-row-avatar ${isComplete ? 'avatar-complete' : (hasOverdue ? 'avatar-overdue' : 'avatar-normal')}">
            ${escapeHtml(initial)}
          </div>
          <div class="user-row-info">
            <div class="dashboard-user-name">${escapeHtml(row.user.displayName)}</div>
            <div class="dashboard-user-role">
              <span class="user-role-tag">${escapeHtml(displayUserRole(row.user))}</span>
              ${row.user.departmentName ? `<span class="user-dept-tag">${escapeHtml(row.user.departmentName)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="user-row-center">
          <div class="dashboard-progress">
            <div class="dashboard-progress-fill ${isComplete ? 'fill-complete' : (hasOverdue ? 'fill-overdue' : 'fill-normal')}"></div>
          </div>
          <div class="dashboard-user-stats">
            <span class="stat-pill pill-total">总 ${row.total}</span>
            <span class="stat-pill pill-completed"><i class="fas fa-check"></i> ${row.completed}</span>
            <span class="stat-pill pill-pending">未完 ${row.pending}</span>
            <span class="stat-pill pill-overdue ${row.overdue > 0 ? 'is-alert' : ''}"><i class="fas fa-exclamation-circle"></i> 逾期 ${row.overdue}</span>
            <span class="stat-pill pill-duesoon ${row.dueSoon > 0 ? 'is-alert' : ''}"><i class="far fa-clock"></i> 临近 ${row.dueSoon}</span>
          </div>
        </div>
        <div class="user-row-rate">
          <div class="dashboard-user-rate ${isComplete ? 'rate-complete' : ''}">${row.rate}%</div>
          <div class="user-rate-label">${isComplete ? '全达成' : '完成率'}</div>
        </div>
      </div>
    `;
    }).join('')
    : '<div class="dashboard-empty"><i class="fas fa-users" style="font-size:2rem;margin-bottom:8px;opacity:0.4;display:block;"></i>当前月份范围内暂无人员任务数据</div>';
}

function dashboardRiskEntries() {
  const now = new Date();
  return dashboardMemos()
    .filter((memo) => !memo.completed)
    .map((memo) => {
      if (isOverdueMemo(memo, now)) return { memo, level: 'danger', label: '已逾期', priority: 1 };
      if (isDueSoonMemo(memo, now)) return { memo, level: 'warning', label: '临近截止', priority: 2 };
      if (isStaleMemo(memo, now)) return { memo, level: 'muted', label: '长时间未更新', priority: 3 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority || (memoDeadlineDate(a.memo)?.getTime() || 0) - (memoDeadlineDate(b.memo)?.getTime() || 0))
    .slice(0, 8);
}

function renderDashboardRisks() {
  const list = $('dashboardRiskList');
  if (!list) return;
  const risks = dashboardRiskEntries();
  list.innerHTML = risks.length
    ? risks.map(({ memo, level, label }) => {
      const icon = level === 'danger' ? 'fas fa-exclamation-circle' : (level === 'warning' ? 'fas fa-clock' : 'fas fa-history');
      const timeStr = memo.dueTime 
        ? new Date(memo.dueTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) 
        : memo.date;
      return `
      <div class="dashboard-risk-item risk-${level}" data-memo-id="${memo.id}" title="点击查看备忘录详情并处理">
        <div class="dashboard-risk-header">
          <span class="risk-badge badge-${level}"><i class="${icon}"></i> ${escapeHtml(label)}</span>
          <span class="dashboard-risk-title">${escapeHtml(memo.title || '无标题任务')}</span>
        </div>
        <div class="dashboard-risk-meta">
          <span class="risk-meta-user"><i class="fas fa-user-circle"></i> ${escapeHtml(memo.ownerName || '未知人员')}</span>
          <span class="risk-meta-time"><i class="far fa-calendar-alt"></i> ${escapeHtml(timeStr)}</span>
          <span class="risk-meta-action"><i class="fas fa-arrow-right"></i> 查看处理</span>
        </div>
      </div>
    `;
    }).join('')
    : '<div class="dashboard-empty"><i class="fas fa-check-circle" style="font-size:2rem;margin-bottom:8px;color:#10b981;display:block;"></i>当前暂无风险任务，团队研发进度良好</div>';
}

function dashboardTrendDays() {
  const { start, end } = visiblePeriodRange();
  const today = new Date();
  const trendEnd = today >= start && today <= end ? today : end;
  const days = [];
  for (let index = 13; index >= 0; index -= 1) {
    const day = new Date(trendEnd);
    day.setDate(trendEnd.getDate() - index);
    if (day >= start && day <= end) days.push(day);
  }
  return days;
}

function renderDashboardTrend() {
  const box = $('dashboardTrend');
  if (!box) return;
  const memos = dashboardMemos();
  const days = dashboardTrendDays();
  const today = new Date();
  const todayKey = dateKey(today);
  const rows = days.map((day) => {
    const key = dateKey(day);
    const total = memos.filter((memo) => memo.date === key).length;
    const completed = memos.filter((memo) => memo.date === key && memo.completed).length;
    const isToday = key === todayKey;
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const weekLabel = `周${weekDays[day.getDay()]}`;
    return { key, label: `${day.getMonth() + 1}/${day.getDate()}`, weekLabel, total, completed, isToday };
  });
  const max = Math.max(1, ...rows.map((row) => row.completed));
  box.innerHTML = rows.some((row) => row.total > 0)
    ? rows.map((row) => {
      const rate = Math.round((row.completed / max) * 100);
      const isAllDone = row.total > 0 && row.completed === row.total;
      return `
      <div class="dashboard-trend-row ${row.isToday ? 'is-today' : ''}">
        <div class="trend-date-col">
          <span class="trend-date">${escapeHtml(row.label)}</span>
          <span class="trend-week">${row.isToday ? '<span class="today-chip">今天</span>' : escapeHtml(row.weekLabel)}</span>
        </div>
        <div class="dashboard-trend-bar" title="${row.label}: 已完成 ${row.completed} / 总 ${row.total}">
          <div class="dashboard-trend-fill ${isAllDone ? 'fill-all-done' : ''}" style="--trend-rate:${rate}%"></div>
        </div>
        <div class="trend-stat-col">
          <span class="trend-badge ${row.completed > 0 ? (isAllDone ? 'badge-all' : 'badge-done') : 'badge-zero'}">${row.completed}</span>
        </div>
      </div>
    `;
    }).join('')
    : '<div class="dashboard-empty"><i class="fas fa-chart-bar" style="font-size:2rem;margin-bottom:8px;opacity:0.4;display:block;"></i>当前范围内暂无可展示趋势</div>';
}

function renderDashboard() {
  const page = $('dashboardPage');
  if (!page || !canManageWorkspace()) return;
  const period = leaderboardPeriodText();
  if ($('dashboardTitle')) $('dashboardTitle').textContent = `${period} 研发进度总览`;
  if ($('dashboardSubtitle')) $('dashboardSubtitle').textContent = '基于当前显示月份，聚合研发任务、人员负载、逾期风险和完成趋势。';
  const summary = dashboardSummary();
  renderDashboardMetrics(summary);
  renderDashboardUserLoad(dashboardUserRows());
  renderDashboardRisks();
  renderDashboardTrend();
}

function renderTeamLeaderboard() {
  const section = $('teamLeaderboard');
  if (!section) return;
  const visible = canManageWorkspace() && state.activeView !== 'dashboard';
  section.hidden = !visible;
  if (!visible) return;

  const rows = leaderboardRows();
  const body = $('leaderboardBody');
  const champion = $('leaderboardChampion');
  const title = $('leaderboardTitle');
  const subtitle = $('leaderboardSubtitle');
  const period = leaderboardPeriodText();
  if (title) title.textContent = `${period} 完成榜`;
  if (subtitle) subtitle.textContent = '按当前显示月份统计，完成率最高的人排在最前面';

  if (!rows.length) {
    if (body) body.className = 'leaderboard-body columns-1';
    if (champion) {
      champion.classList.remove('leaderboard-clickable');
      champion.removeAttribute('data-user-id');
      champion.removeAttribute('title');
      champion.innerHTML = `
        <span class="champion-crown">🏆</span>
        <div>
          <div class="champion-label">暂未产生冠军</div>
          <strong>等待任务完成</strong>
        </div>
      `;
    }
    if (body) body.innerHTML = '<div class="leaderboard-empty">当前月份范围内暂无可统计任务</div>';
    return;
  }

  const leader = rows[0];
  if (champion) {
    champion.classList.add('leaderboard-clickable');
    champion.dataset.userId = String(leader.user.id);
    champion.title = `点击查看${leader.user.displayName}的日历`;
    champion.innerHTML = `
      <span class="champion-crown">🏆</span>
      <div>
        <div class="champion-label">当前领先</div>
        <strong>${escapeHtml(leader.user.displayName)} · ${leader.rate}%</strong>
      </div>
    `;
  }

  if (!body) return;
  const displayRows = rows;
  const columnCount = Math.min(4, Math.max(1, displayRows.length));
  body.className = `leaderboard-body columns-${columnCount}`;
  body.innerHTML = displayRows.map((row, index) => {
    const rank = index + 1;
    const isComplete = row.rate === 100;
    return `
      <div class="leaderboard-card rank-${rank} ${isComplete ? 'is-complete' : ''} ${String(row.user.id) === String(state.selectedUserId) ? 'active' : ''}" data-user-id="${row.user.id}" title="点击查看${escapeHtml(row.user.displayName)}的日历" style="--leaderboard-rate:${row.rate}%">
        <div class="leaderboard-card-head">
          <span class="leaderboard-rank">${rank}</span>
          <div class="leaderboard-person">
            <div class="leaderboard-name">${escapeHtml(row.user.displayName)} ${rank === 1 ? '<span class="rank-crown-mini" title="当前第1名">👑</span>' : ''}</div>
            <div class="leaderboard-role">${escapeHtml(displayUserRole(row.user))} · ${escapeHtml(row.user.departmentName || '')}</div>
          </div>
          <div class="leaderboard-rate">${row.rate}%</div>
        </div>
        <div class="leaderboard-bar"><div class="leaderboard-bar-fill"></div></div>
        <div class="leaderboard-stats">
          <span class="stat-completed"><i class="fas fa-check-circle"></i> 完成 ${row.completed}/${row.total}</span>
          <span class="stat-pending">${row.pending > 0 ? `<i class="far fa-clock"></i> 未完成 ${row.pending}` : '<i class="fas fa-check-double"></i> 全部完成'}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function openDashboardMemo(memoId) {
  const memo = dashboardMemos().find((item) => String(item.id) === String(memoId));
  if (!memo) return;
  state.activeView = 'calendar';
  state.selectedUserId = String(memo.ownerId);
  const memberSelect = $('serverMemberSelect');
  if (memberSelect) memberSelect.value = state.selectedUserId;
  renderCustomMemberOptions();
  refreshMemoViews();
  await openMemoModal(memoId);
}

function jumpToUserCalendar(userId) {
  if (!canManageWorkspace()) return;
  const user = state.users.find((item) => String(item.id) === String(userId));
  if (!user) return;

  state.activeView = 'calendar';
  state.selectedUserId = String(user.id);
  const memberSelect = $('serverMemberSelect');
  if (memberSelect) memberSelect.value = state.selectedUserId;
  renderCustomMemberOptions();

  const searchInput = $('searchInput');
  if (searchInput?.value) {
    searchInput.value = '';
    if ($('clearSearch')) $('clearSearch').style.display = 'none';
  }

  refreshMemoViews();
  window.requestAnimationFrame(() => {
    $('multiMonthCalendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function memoOwnerSuffix(memo) {
  return state.selectedUserId === 'all' && memo.ownerName ? `（${memo.ownerName}）` : '';
}

function memoFullTitle(memo) {
  return `${memo.title || '无标题'}${memoOwnerSuffix(memo)}`;
}

function memoDisplayTitle(memo) {
  const title = memo.title || '无标题';
  const suffix = memoOwnerSuffix(memo);
  const limit = state.monthsToShow > 4 ? 5 : 15;
  if (!suffix) return title.length > limit ? `${title.slice(0, limit)}...` : title;
  const fullTitle = `${title}${suffix}`;
  if (fullTitle.length <= limit) return fullTitle;
  const titleLimit = Math.max(1, limit - suffix.length - 3);
  return `${title.slice(0, titleLimit)}...${suffix}`;
}

function sortCalendarDayMemos(memos) {
  return [...memos].sort((a, b) => (
    Number(Boolean(a.completed)) - Number(Boolean(b.completed))
    || String(a.ownerName || '').localeCompare(String(b.ownerName || ''), 'zh-CN')
    || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
    || Number(a.id || 0) - Number(b.id || 0)
  ));
}

function createProgressCircle(percent, index) {
  return `
    <div class="month-progress">
      <div class="progress-circle" id="progressCircle${index}">
        <svg viewBox="0 0 36 36">
          <path class="progress-circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"></path>
          <path class="progress-circle-fill" stroke-dasharray="${percent}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"></path>
        </svg>
        <div class="progress-percent">${percent}%</div>
      </div>
    </div>
  `;
}

function createMonthCalendar(monthDate, index) {
  const visibleMemos = getVisibleMemos();
  const calendarMemos = getCalendarMemos();
  const monthMemos = visibleMemos.filter((memo) => memo.date.startsWith(monthKey(monthDate)));
  const completed = monthMemos.filter((memo) => memo.completed).length;
  const progressPercent = monthMemos.length ? Math.round((completed / monthMemos.length) * 100) : 0;
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const today = dateKey(new Date());
  const cells = [];

  for (let i = firstDay.getDay(); i > 0; i--) {
    const day = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - i);
    cells.push(`<div class="calendar-day other-month">${day.getDate()}</div>`);
  }

  for (let i = 1; i <= lastDay.getDate(); i++) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), i);
    const key = dateKey(date);
    const dayMemos = sortCalendarDayMemos(calendarMemos.filter((memo) => memo.date === key));
    const classes = ['calendar-day'];
    if (key === today) classes.push('today');
    cells.push(`
      <div class="${classes.join(' ')}" data-date="${key}">
        <div class="day-number">
          <span class="day-number-text" data-date="${key}" role="button" tabindex="0" aria-label="查看${key}的${dayMemos.length}条事项">${i}</span>
          <div class="day-number-actions">
            <button class="day-add" data-date="${key}" title="添加详细备忘录" aria-label="在${key}添加备忘录" type="button"><i class="fas fa-plus"></i></button>
            ${dayMemos.length ? `<button class="memo-count" title="查看当天全部事项" aria-label="查看${key}的${dayMemos.length}条事项" type="button">${dayMemos.length}</button>` : ''}
          </div>
        </div>
        <div class="day-memos" id="dayMemos-${key}">
          ${dayMemos.map((memo, memoIndex) => {
            const memoColor = memo.color || colors[memoIndex % colors.length] || colors[0];
            const hasOwner = Boolean(state.selectedUserId === 'all' && memo.ownerName);
            const dotColor = memo.completed ? '#94a3b8' : memoColor;
            return `
            <button class="day-memo-item ${memo.completed ? 'completed' : ''}" data-memo-id="${memo.id}" title="${escapeHtml(memoFullTitle(memo))}" aria-label="${escapeHtml(memoFullTitle(memo))}" type="button" style="--memo-color:${escapeHtml(dotColor)}">
              <span class="memo-color-dot" style="background-color:${escapeHtml(dotColor)}"></span>
              <span class="memo-title-text">${escapeHtml(memo.title || '无标题')}</span>
              ${hasOwner ? `<span class="memo-owner-pill">${escapeHtml(memo.ownerName)}</span>` : ''}
            </button>
          `;
          }).join('')}
        </div>
      </div>
    `);
  }

  while (cells.length < 42) {
    const next = cells.length - (firstDay.getDay() + lastDay.getDate()) + 1;
    cells.push(`<div class="calendar-day other-month">${next}</div>`);
  }

  return `
    <div class="month-calendar card ${state.monthsToShow > 4 ? 'small' : ''}" id="monthCalendar${index}" data-month="${monthDate.getMonth()}" data-year="${monthDate.getFullYear()}">
      <div class="month-header card-header">
        <div class="month-title">${monthDate.getFullYear()}年 ${monthNames[monthDate.getMonth()]}</div>
        <div class="month-right-area">
          <div class="month-stats" id="monthStats${index}">
            <button class="stat-item total ${state.calendarStatusFilter === 'all' ? 'active' : ''}" data-status-filter="all" title="显示全部任务" aria-label="显示全部${monthMemos.length}条任务" type="button"><i class="fas fa-tasks"></i><span class="stat-count-total">${monthMemos.length}</span></button>
            <button class="stat-item completed ${state.calendarStatusFilter === 'completed' ? 'active' : ''}" data-status-filter="completed" title="只显示已完成任务" aria-label="只显示已完成${completed}条任务" type="button"><i class="fas fa-check-circle"></i><span class="stat-count-completed">${completed}</span></button>
            <button class="stat-item pending ${state.calendarStatusFilter === 'pending' ? 'active' : ''}" data-status-filter="pending" title="只显示未完成任务" aria-label="只显示未完成${monthMemos.length - completed}条任务" type="button"><i class="fas fa-clock"></i><span class="stat-count-pending">${monthMemos.length - completed}</span></button>
          </div>
          ${createProgressCircle(progressPercent, index)}
          ${monthMemos.length === 0
            ? `<button class="complete-all-btn empty-disabled" data-month="${monthKey(monthDate)}" type="button" disabled title="本月暂无任务"><i class="fas fa-inbox"></i> 暂无事项</button>`
            : (monthMemos.length - completed === 0
              ? `<button class="complete-all-btn all-completed" data-month="${monthKey(monthDate)}" type="button" disabled title="本月任务已全部完成"><i class="fas fa-check-circle"></i> 全部已完成</button>`
              : `<button class="complete-all-btn active" data-month="${monthKey(monthDate)}" type="button" title="点击将本月所有未完成事项一键标记为完成"><i class="fas fa-check-double"></i> 一键完成</button>`
            )}
        </div>
      </div>
      <div class="weekdays"><div>日</div><div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div></div>
      <div class="calendar-grid" id="calendarGrid${index}">${cells.join('')}</div>
    </div>
  `;
}

function renderColorOptions(activeColor = colors[0], target = 'memo') {
  const box = target === 'task' ? $('taskColorOptions') : $('colorOptions');
  if (!box) return;
  box.innerHTML = colors.map((color) => `<div class="color-option ${color === activeColor ? 'selected' : ''}" data-color="${color}" data-target="${target}" style="background-color:${color}"></div>`).join('');
}

function syncMemoCompletedState() {
  const checkbox = $('memoCompleted');
  const label = checkbox?.closest('.memo-title-completed');
  if (label && checkbox) {
    label.classList.toggle('is-completed', Boolean(checkbox.checked));
  }
}

async function openMemoModal(memoId = null, date = new Date(), draft = {}) {
  setOperationFeedback('memoSaveFeedback', '');
  state.selectedMemoId = memoId;
  const requestVersion = ++state.memoDetailRequestVersion;
  const dateValue = date instanceof Date ? dateKey(date) : String(date);
  const draftTitle = String(draft.title || '').trim();
  let memo = memoId ? state.memos.find((item) => String(item.id) === String(memoId)) : null;

  // 若本地缓存中已包含完整内容，则无需再次发起网络请求
  const hasFullContent = memo && Object.prototype.hasOwnProperty.call(memo, 'content') && memo.content !== undefined;

  if (memoId && !hasFullContent) {
    try {
      const data = await request(`/memos/${memoId}`);
      if (requestVersion !== state.memoDetailRequestVersion || String(state.selectedMemoId) !== String(memoId)) return;
      if (data?.memo) {
        memo = data.memo;
        // 缓存到本地 state.memos，加速下次秒开
        const idx = state.memos.findIndex((item) => String(item.id) === String(memoId));
        if (idx !== -1) {
          state.memos[idx] = { ...state.memos[idx], ...data.memo };
        }
      }
    } catch (error) {
      if (requestVersion !== state.memoDetailRequestVersion || String(state.selectedMemoId) !== String(memoId)) return;
      console.warn(`读取任务详情失败，使用本地缓存显示: ${error.message}`);
      // 容错降级：如果本地已有该任务基本信息，绝不阻断用户打开弹窗！
      if (memo) {
        memo = { ...memo, content: memo.content || memo.contentPreview || '' };
      } else {
        alert(`读取任务详情失败：${error.message}`);
        return;
      }
    }
  }

  if (requestVersion !== state.memoDetailRequestVersion || String(state.selectedMemoId) !== String(memoId)) return;
  state.detailDraftFromQuickAdd = Boolean(!memo && draft.fromQuickAdd);

  // 权限控制：管理员或任务所有者可编辑，其他成员为只读查看
  const canEdit = (!memo || canManageWorkspace() || Number(memo.ownerId) === Number(state.user?.id))
    && !memo?.rolloverToId;

  // 动态更新模态窗标题与只读状态
  const modalTitle = $('memoModal')?.querySelector('.modal-title');
  if (modalTitle) {
    if (!canEdit) {
      modalTitle.innerHTML = `<i class="fas fa-eye"></i> 查看备忘录${memo?.ownerName ? `（所属：${escapeHtml(memo.ownerName)}）` : ''}`;
    } else {
      modalTitle.innerHTML = memo
        ? '<i class="fas fa-edit"></i> 编辑备忘录'
        : '<i class="fas fa-plus-circle"></i> 添加详细备忘录';
    }
  }

  const titleInput = $('memoTitle');
  const dateInput = $('memoDate');
  const contentInput = $('memoContent');
  const completedCheckbox = $('memoCompleted');
  const saveBtn = $('saveMemo');
  const deleteBtn = $('deleteMemo');

  if (titleInput) {
    titleInput.value = memo?.title || draftTitle;
    titleInput.readOnly = !canEdit;
  }
  if (dateInput) {
    dateInput.value = memo?.date || dateValue;
    dateInput.readOnly = true;
    dateInput.dataset.canEdit = canEdit ? 'true' : 'false';
  }
  hideMemoCalendarPopup();

  // 智能预设默认截止时间
  {
    let dtVal;
    if (memo?.dueTime) {
      dtVal = toLocalDateTimeInput(memo.dueTime);
    } else {
      const todayStr = dateKey(new Date());
      const nowHour = new Date().getHours();
      const defaultTime = (dateValue === todayStr && nowHour >= 18) ? '23:59' : '18:00';
      dtVal = `${dateValue}T${defaultTime}`;
    }
    setMemoDuePickerValue(dtVal);
    const displayInput = $('memoDueTimeDisplay');
    const duePicker = $('memoDueWrap');
    if (displayInput) displayInput.readOnly = true; // always readonly; picker is the UI
    if (duePicker) duePicker.dataset.canEdit = canEdit ? 'true' : 'false';
    hideMemoCalendarDuePopup();
  }

  if (contentInput) {
    contentInput.value = memo?.content || memo?.contentPreview || '';
    contentInput.readOnly = !canEdit;
  }
  if (completedCheckbox) {
    completedCheckbox.checked = Boolean(memo?.completed);
    completedCheckbox.disabled = !canEdit;
  }
  const weeklyPlanCheckbox = $('memoWeeklyPlan');
  if (weeklyPlanCheckbox) {
    weeklyPlanCheckbox.checked = memo ? (memo.planKind === 'plan') : (state.activeView === 'weeklyPlan');
    weeklyPlanCheckbox.disabled = !canEdit;
  }
  syncMemoCompletedState();

  if (saveBtn) saveBtn.style.display = canEdit ? 'inline-flex' : 'none';
  if (deleteBtn) deleteBtn.style.display = (memo && canEdit) ? 'inline-flex' : 'none';

  state.selectedMemoColor = memo?.color || randomMemoColor(latestMemoColor());
  renderColorOptions(state.selectedMemoColor, 'memo');
  switchMemoContentTab('edit');
  document.querySelectorAll('.quick-due-chip').forEach(c => {
    c.classList.remove('active');
    c.style.pointerEvents = canEdit ? 'auto' : 'none';
  });
  updateMarkdownPreview();
  showDialog('memoModal', canEdit ? 'memoTitle' : null);
}

function closeMemoModal() {
  if (state.memoSaveBusy) return;
  hideMemoCalendarPopup();
  hideMemoCalendarDuePopup();
  state.memoDetailRequestVersion += 1;
  hideDialog('memoModal');
  state.selectedMemoId = null;
  state.detailDraftFromQuickAdd = false;
}

let memoPickerState = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1
};

function hideMemoCalendarPopup() {
  const popup = $('memoCalendarPopup');
  if (popup) popup.hidden = true;
}

function showMemoCalendarPopup() {
  const dateInput = $('memoDate');
  if (!dateInput || dateInput.dataset.canEdit === 'false') return;
  const popup = $('memoCalendarPopup');
  if (!popup) return;

  const val = dateInput.value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(val || '');
  if (match) {
    memoPickerState.currentYear = Number(match[1]);
    memoPickerState.currentMonth = Number(match[2]);
  } else {
    const now = new Date();
    memoPickerState.currentYear = now.getFullYear();
    memoPickerState.currentMonth = now.getMonth() + 1;
  }

  renderMemoCalendarPopup();
  popup.hidden = false;
}

function renderMemoCalendarPopup() {
  const popup = $('memoCalendarPopup');
  if (!popup) return;

  const { currentYear, currentMonth } = memoPickerState;
  const label = $('mcpMonthLabel');
  if (label) label.textContent = `${currentYear}年 ${currentMonth}月`;

  const grid = $('mcpGrid');
  if (!grid) return;

  const selectedDateStr = $('memoDate')?.value || '';
  const todayStr = dateKey(new Date());

  const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1);
  let startDayOfWeek = firstDayOfMonth.getDay();
  if (startDayOfWeek === 0) startDayOfWeek = 7;

  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const prevMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate();

  let html = '';

  for (let i = startDayOfWeek - 1; i > 0; i--) {
    const dayNum = prevMonthDays - i + 1;
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const dStr = `${prevYear}-${pad(prevMonth)}-${pad(dayNum)}`;
    html += `<button type="button" class="mcp-day mcp-other-month" data-date="${dStr}">${dayNum}</button>`;
  }

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dStr = `${currentYear}-${pad(currentMonth)}-${pad(dayNum)}`;
    const isToday = dStr === todayStr;
    const isSelected = dStr === selectedDateStr;
    let cls = 'mcp-day';
    if (isSelected) cls += ' mcp-selected';
    else if (isToday) cls += ' mcp-today';
    html += `<button type="button" class="${cls}" data-date="${dStr}">${dayNum}</button>`;
  }

  const totalRendered = (startDayOfWeek - 1) + daysInMonth;
  const remainder = totalRendered % 7;
  const daysToAdd = remainder === 0 ? 0 : 7 - remainder;
  for (let dayNum = 1; dayNum <= daysToAdd; dayNum++) {
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    const dStr = `${nextYear}-${pad(nextMonth)}-${pad(dayNum)}`;
    html += `<button type="button" class="mcp-day mcp-other-month" data-date="${dStr}">${dayNum}</button>`;
  }

  grid.innerHTML = html;
}

function selectMemoPickerDate(dateStr) {
  const dateInput = $('memoDate');
  if (dateInput) {
    dateInput.value = dateStr;
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    dateInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const dueInput = $('memoDueTime');
  if (dueInput && dueInput.value) {
    const [dueDatePart, dueTimePart] = dueInput.value.split('T');
    // 只有当截止日期早于新开始日期时，才自动顺延校正截止日期至开始日期当天
    if (dueDatePart && dueDatePart < dateStr) {
      setMemoDuePickerValue(`${dateStr}T${dueTimePart || '18:00'}`);
    }
  } else if (dueInput && !dueInput.value) {
    setMemoDuePickerValue(`${dateStr}T18:00`);
  }

  hideMemoCalendarPopup();
}

function initMemoDatePicker() {
  const wrap = $('memoDateWrap');
  const dateInput = $('memoDate');
  if (!wrap || !dateInput) return;
  if (wrap.dataset.bound === 'true') return;
  wrap.dataset.bound = 'true';

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('#memoCalendarPopup')) return;
    const popup = $('memoCalendarPopup');
    if (popup && !popup.hidden) {
      hideMemoCalendarPopup();
    } else {
      showMemoCalendarPopup();
    }
  });

  $('mcpPrevMonth')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (memoPickerState.currentMonth === 1) {
      memoPickerState.currentYear -= 1;
      memoPickerState.currentMonth = 12;
    } else {
      memoPickerState.currentMonth -= 1;
    }
    renderMemoCalendarPopup();
  });

  $('mcpNextMonth')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (memoPickerState.currentMonth === 12) {
      memoPickerState.currentYear += 1;
      memoPickerState.currentMonth = 1;
    } else {
      memoPickerState.currentMonth += 1;
    }
    renderMemoCalendarPopup();
  });

  $('mcpTodayBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const todayStr = dateKey(new Date());
    selectMemoPickerDate(todayStr);
  });

  $('mcpCloseBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideMemoCalendarPopup();
  });

  $('mcpGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mcp-day[data-date]');
    if (btn) {
      e.stopPropagation();
      selectMemoPickerDate(btn.dataset.date);
    }
  });

  document.addEventListener('click', (e) => {
    const popup = $('memoCalendarPopup');
    if (popup && !popup.hidden && !wrap.contains(e.target)) {
      hideMemoCalendarPopup();
    }
  });
}

/* ── 截止时间 自定义选择器 ─────────────────────────── */
let memoDuePickerState = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  selectedDate: ''
};

function setMemoDuePickerValue(datetimeLocalStr) {
  const hidden = $('memoDueTime');
  const display = $('memoDueTimeDisplay');
  if (!datetimeLocalStr) {
    if (hidden) hidden.value = '';
    if (display) display.value = '';
    memoDuePickerState.selectedDate = '';
    return;
  }
  if (hidden) hidden.value = datetimeLocalStr;
  const [datePart, timePart] = datetimeLocalStr.split('T');
  memoDuePickerState.selectedDate = datePart || '';
  const [hh, mm] = (timePart || '18:00').split(':');
  const hourEl = $('mdpHour');
  const minEl = $('mdpMinute');
  if (hourEl) hourEl.value = parseInt(hh, 10);
  if (minEl) minEl.value = parseInt(mm, 10);
  if (display && datePart) {
    display.value = `${datePart} ${pad(parseInt(hh,10))}:${pad(parseInt(mm,10))}`;
  }
}

function hideMemoCalendarDuePopup() {
  const popup = $('memoDuePopup');
  if (popup) popup.hidden = true;
}

function showMemoDuePickerPopup() {
  const wrap = $('memoDueWrap');
  if (wrap && wrap.dataset.canEdit === 'false') return;
  const popup = $('memoDuePopup');
  if (!popup) return;
  const selDate = memoDuePickerState.selectedDate;
  const match = /^(\d{4})-(\d{2})/.exec(selDate || '');
  if (match) {
    memoDuePickerState.currentYear = Number(match[1]);
    memoDuePickerState.currentMonth = Number(match[2]);
  } else {
    const now = new Date();
    memoDuePickerState.currentYear = now.getFullYear();
    memoDuePickerState.currentMonth = now.getMonth() + 1;
  }
  renderMemoDueCalendar();
  popup.hidden = false;
}

function renderMemoDueCalendar() {
  const popup = $('memoDuePopup');
  if (!popup) return;
  const { currentYear, currentMonth, selectedDate } = memoDuePickerState;
  const label = $('mdpMonthLabel');
  if (label) label.textContent = `${currentYear}年 ${currentMonth}月`;
  const grid = $('mdpGrid');
  if (!grid) return;
  const todayStr = dateKey(new Date());
  const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1);
  let startDayOfWeek = firstDayOfMonth.getDay();
  if (startDayOfWeek === 0) startDayOfWeek = 7;
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const prevMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate();
  let html = '';
  for (let i = startDayOfWeek - 1; i > 0; i--) {
    const dayNum = prevMonthDays - i + 1;
    const pMon = currentMonth === 1 ? 12 : currentMonth - 1;
    const pYr = currentMonth === 1 ? currentYear - 1 : currentYear;
    html += `<button type="button" class="mcp-day mcp-other-month" data-date="${pYr}-${pad(pMon)}-${pad(dayNum)}">${dayNum}</button>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${currentYear}-${pad(currentMonth)}-${pad(d)}`;
    let cls = 'mcp-day';
    if (dStr === selectedDate) cls += ' mcp-selected';
    else if (dStr === todayStr) cls += ' mcp-today';
    html += `<button type="button" class="${cls}" data-date="${dStr}">${d}</button>`;
  }
  const totalRendered = (startDayOfWeek - 1) + daysInMonth;
  const remainder = totalRendered % 7;
  const daysToAdd = remainder === 0 ? 0 : 7 - remainder;
  for (let d = 1; d <= daysToAdd; d++) {
    const nMon = currentMonth === 12 ? 1 : currentMonth + 1;
    const nYr = currentMonth === 12 ? currentYear + 1 : currentYear;
    html += `<button type="button" class="mcp-day mcp-other-month" data-date="${nYr}-${pad(nMon)}-${pad(d)}">${d}</button>`;
  }
  grid.innerHTML = html;
}

function commitMemoDuePicker() {
  const hourEl = $('mdpHour');
  const minEl = $('mdpMinute');
  const selDate = memoDuePickerState.selectedDate;
  if (!selDate) return;
  const hh = Math.max(0, Math.min(23, parseInt(hourEl?.value ?? '18', 10) || 18));
  const mm = Math.max(0, Math.min(59, parseInt(minEl?.value ?? '0', 10) || 0));
  setMemoDuePickerValue(`${selDate}T${pad(hh)}:${pad(mm)}`);
}

function initMemoDuePicker() {
  const wrap = $('memoDueWrap');
  if (!wrap) return;
  if (wrap.dataset.bound === 'true') return;
  wrap.dataset.bound = 'true';

  const displayInput = $('memoDueTimeDisplay');
  if (displayInput) {
    displayInput.addEventListener('click', (e) => {
      e.stopPropagation();
      const popup = $('memoDuePopup');
      if (popup && !popup.hidden) {
        commitMemoDuePicker();
        hideMemoCalendarDuePopup();
      } else {
        showMemoDuePickerPopup();
      }
    });
  }
  const iconEl = $('memoDueIcon');
  if (iconEl) {
    iconEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const popup = $('memoDuePopup');
      if (popup && !popup.hidden) {
        commitMemoDuePicker();
        hideMemoCalendarDuePopup();
      } else {
        showMemoDuePickerPopup();
      }
    });
  }

  $('mdpPrevMonth')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (memoDuePickerState.currentMonth === 1) { memoDuePickerState.currentYear -= 1; memoDuePickerState.currentMonth = 12; }
    else { memoDuePickerState.currentMonth -= 1; }
    renderMemoDueCalendar();
  });

  $('mdpNextMonth')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (memoDuePickerState.currentMonth === 12) { memoDuePickerState.currentYear += 1; memoDuePickerState.currentMonth = 1; }
    else { memoDuePickerState.currentMonth += 1; }
    renderMemoDueCalendar();
  });

  $('mdpTodayBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    memoDuePickerState.selectedDate = dateKey(new Date());
    renderMemoDueCalendar();
  });

  $('mdpGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mcp-day[data-date]');
    if (!btn) return;
    e.stopPropagation();
    memoDuePickerState.selectedDate = btn.dataset.date;
    renderMemoDueCalendar();
  });

  $('mdpCloseBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    commitMemoDuePicker();
    hideMemoCalendarDuePopup();
  });

  [$('mdpHour'), $('mdpMinute')].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => { if (memoDuePickerState.selectedDate) commitMemoDuePicker(); });
    el.addEventListener('click', (e) => e.stopPropagation());
  });

  document.addEventListener('click', (e) => {
    const popup = $('memoDuePopup');
    if (popup && !popup.hidden && !wrap.contains(e.target)) {
      commitMemoDuePicker();
      hideMemoCalendarDuePopup();
    }
  });
}

function initMemoHoverTooltip() {
  let tooltip = $('memoHoverTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'memoHoverTooltip';
    tooltip.className = 'memo-hover-tooltip';
    document.body.appendChild(tooltip);
  }

  const calendar = $('multiMonthCalendar');
  if (!calendar || calendar.dataset.tooltipBound === 'true') return;
  calendar.dataset.tooltipBound = 'true';

  let currentTarget = null;

  calendar.addEventListener('mouseover', (e) => {
    if (window.matchMedia?.('(max-width: 768px)').matches) return;
    const memoItem = e.target.closest('.day-memo-item[data-memo-id]');
    if (!memoItem || memoItem === currentTarget) return;
    currentTarget = memoItem;

    const memoId = memoItem.dataset.memoId;
    const memo = state.memos.find((m) => String(m.id) === String(memoId));
    if (!memo) return;

    const dotColor = memo.completed ? '#94a3b8' : (memo.color || '#3b82f6');
    const deadline = memoDeadlineDate(memo);
    const timeText = deadline
      ? `${deadline.getFullYear()}/${deadline.getMonth() + 1}/${deadline.getDate()} ${pad(deadline.getHours())}:${pad(deadline.getMinutes())}`
      : (memo.date || '无时间');

    tooltip.innerHTML = `
      <div class="mht-header">
        <span class="mht-dot" style="background:${escapeHtml(dotColor)}"></span>
        <div class="mht-title">${escapeHtml(memoFullTitle(memo))}</div>
      </div>
      ${memo.contentPreview ? `<div class="mht-content">${escapeHtml(memo.contentPreview)}</div>` : ''}
      <div class="mht-meta">
        <span><i class="far fa-clock"></i> ${escapeHtml(timeText)}</span>
        <span class="mht-badge ${memo.completed ? 'completed' : 'pending'}">${memo.completed ? '已完成' : '进行中'}</span>
      </div>
    `;

    positionTooltip(memoItem);
    tooltip.classList.add('visible');
  });

  function positionTooltip(el) {
    const rect = el.getBoundingClientRect();
    const ttWidth = 270;
    const spaceRight = window.innerWidth - rect.right;
    let left = spaceRight >= ttWidth + 12 ? rect.right + 8 : rect.left - ttWidth - 8;
    if (left < 10) left = 10;
    let top = rect.top - 8;
    if (top + 160 > window.innerHeight) top = window.innerHeight - 170;
    if (top < 10) top = 10;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  calendar.addEventListener('mouseout', (e) => {
    const memoItem = e.target.closest('.day-memo-item[data-memo-id]');
    if (!memoItem) return;
    const related = e.relatedTarget;
    if (memoItem.contains(related)) return;
    currentTarget = null;
    tooltip.classList.remove('visible');
  });

  window.addEventListener('scroll', () => {
    if (currentTarget) {
      currentTarget = null;
      tooltip.classList.remove('visible');
    }
  }, { passive: true });
}

function toLocalDateTimeInput(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function switchMemoContentTab(mode) {
  const editTab = $('memoTabEdit');
  const previewTab = $('memoTabPreview');
  const toolbar = $('memoTextToolbar');
  const textarea = $('memoContent');
  const preview = $('markdownPreview');
  if (!editTab || !previewTab || !textarea || !preview) return;

  if (mode === 'preview') {
    editTab.classList.remove('active');
    previewTab.classList.add('active');
    if (toolbar) toolbar.style.display = 'none';
    textarea.style.display = 'none';
    preview.style.display = 'block';
    updateMarkdownPreview();
  } else {
    previewTab.classList.remove('active');
    editTab.classList.add('active');
    if (toolbar) toolbar.style.display = 'flex';
    textarea.style.display = 'block';
    try {
      textarea.focus({ preventScroll: true });
    } catch (e) {
      textarea.focus();
    }
  }
}

function handleQuickDueChipClick(event) {
  const chip = event.target.closest('.quick-due-chip');
  if (!chip) return;
  const preset = chip.dataset.preset;
  const target = new Date();

  if (preset === 'today-end') {
    target.setHours(18, 0, 0, 0);
  } else if (preset === 'tomorrow-end') {
    target.setDate(target.getDate() + 1);
    target.setHours(18, 0, 0, 0);
  } else if (preset === 'this-friday') {
    const day = target.getDay(); // 0 is Sun, 5 is Fri
    const diff = (5 - day + 7) % 7 || 7;
    target.setDate(target.getDate() + diff);
    target.setHours(18, 0, 0, 0);
  } else if (preset === 'next-monday') {
    const day = target.getDay();
    const diff = (1 - day + 7) % 7 || 7;
    target.setDate(target.getDate() + diff);
    target.setHours(18, 0, 0, 0);
  }

  // 快捷截止时间仅设置“截止时间”，绝不覆盖修改任务的“开始日期”
  const dateInput = $('memoDate');
  if (dateInput && !dateInput.value) {
    dateInput.value = dateKey(new Date());
  }
  setMemoDuePickerValue(toLocalDateTimeInput(target));

  document.querySelectorAll('.quick-due-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
}

function updateMarkdownPreview() {
  const content = $('memoContent')?.value || '';
  const preview = $('markdownPreview');
  const wordCount = $('memoContentWordCount');
  if (wordCount) wordCount.textContent = `${content.length} 字`;
  if (!preview) return;
  if (window.marked && content.trim()) preview.innerHTML = marked.parse(content, { breaks: true, gfm: true });
  else preview.textContent = content.trim() || '预览将在这里显示...';
}

function replaceMemoContentRange(textarea, start, end, replacement, selectionStart, selectionEnd) {
  textarea.setRangeText(replacement, start, end, 'end');
  textarea.setSelectionRange(selectionStart, selectionEnd);
  textarea.focus();
  updateMarkdownPreview();
}

function formatMemoInline(leftMark, rightMark = leftMark, placeholder = '文字') {
  const textarea = $('memoContent');
  if (!textarea) return;
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end) || placeholder;
  const replacement = `${leftMark}${selected}${rightMark}`;
  replaceMemoContentRange(textarea, start, end, replacement, start + leftMark.length, start + leftMark.length + selected.length);
}

function stripMemoHeading(line) {
  return line.replace(/^#{1,6}\s+/, '');
}

function stripMemoListMarker(line) {
  return line.replace(/^\s*(?:- \[[ xX]\]|[-*+]|\d+\.)\s+/, '');
}

function formatMemoLines(formatter, placeholder) {
  const textarea = $('memoContent');
  if (!textarea) return;
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  if (start === end) {
    const replacement = formatter(placeholder, 0);
    const placeholderStart = replacement.indexOf(placeholder);
    const selectStart = start + Math.max(placeholderStart, 0);
    replaceMemoContentRange(textarea, start, end, replacement, selectStart, selectStart + placeholder.length);
    return;
  }

  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const rawLineEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = value.indexOf('\n', rawLineEnd);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const selectedBlock = value.slice(lineStart, lineEnd);
  const replacement = selectedBlock
    .split('\n')
    .map((line, index) => formatter(line || placeholder, index))
    .join('\n');
  replaceMemoContentRange(textarea, lineStart, lineEnd, replacement, lineStart, lineStart + replacement.length);
}

function applyMemoTextFormat(format) {
  const textarea = $('memoContent');
  if (!textarea) return;

  const actions = {
    h1: () => formatMemoLines((line) => `# ${stripMemoHeading(line)}`, '标题'),
    h2: () => formatMemoLines((line) => `## ${stripMemoHeading(line)}`, '标题'),
    bold: () => formatMemoInline('**'),
    italic: () => formatMemoInline('*'),
    strike: () => formatMemoInline('~~'),
    ul: () => formatMemoLines((line) => `- ${stripMemoListMarker(line)}`, '列表项'),
    ol: () => formatMemoLines((line, index) => `${index + 1}. ${stripMemoListMarker(line)}`, '列表项'),
    task: () => formatMemoLines((line) => `- [ ] ${stripMemoListMarker(line)}`, '待办事项')
  };

  actions[format]?.();
}

function handleMemoTextToolbarClick(event) {
  const button = event.target.closest?.('[data-format]');
  if (!button) return;
  event.preventDefault();
  applyMemoTextFormat(button.dataset.format);
}

function continueOrderedMemoLine(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  const textarea = event.currentTarget;
  if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return;

  const cursor = textarea.selectionStart;
  const lineStart = textarea.value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const lineBeforeCursor = textarea.value.slice(lineStart, cursor);
  const match = /^(\s*)(\d+)\.\s*.*$/.exec(lineBeforeCursor);
  if (!match) return;

  event.preventDefault();
  const nextMarker = `${match[1]}${Number(match[2]) + 1}.`;
  const replacement = `\n${nextMarker}`;
  const cursorAfterMarker = cursor + replacement.length;
  replaceMemoContentRange(textarea, cursor, cursor, replacement, cursorAfterMarker, cursorAfterMarker);
}

async function saveMemo() {
  if (state.memoSaveBusy) return;
  const title = $('memoTitle').value.trim();
  const dueTime = $('memoDueTime').value;
  if (!title) {
    alert('请输入标题');
    return;
  }
  if (!dueTime) {
    alert('请添加截止时间后再保存');
    showMemoDuePickerPopup();
    return;
  }
  const payload = {
    ownerId: state.selectedUserId !== 'all' ? Number(state.selectedUserId) : state.user.id,
    date: $('memoDate').value,
    title,
    content: $('memoContent').value,
    color: state.selectedMemoColor,
    completed: $('memoCompleted').checked,
    planKind: $('memoWeeklyPlan')?.checked ? 'plan' : 'memo',
    dueTime
  };
  const isNewMemo = !state.selectedMemoId;
  const shouldClearQuickDraft = isNewMemo && state.detailDraftFromQuickAdd;
  const button = $('saveMemo');
  const originalLabel = button.textContent;
  state.memoSaveBusy = true;
  button.disabled = true;
  button.textContent = '保存中…';
  setOperationFeedback('memoSaveFeedback', '');

  // 记录保存前的全局滚动位置与日历格子内滚动位置，确保保存后视野绝不自动滚到最顶部
  const targetDateKey = payload.date;
  const dayMemosEl = targetDateKey ? $(`dayMemos-${targetDateKey}`) : null;
  const dayMemosScrollTop = dayMemosEl ? dayMemosEl.scrollTop : 0;
  const pageScrollX = window.scrollX ?? window.pageXOffset ?? 0;
  const pageScrollY = window.scrollY ?? window.pageYOffset ?? 0;

  let data;
  try {
    data = state.selectedMemoId
      ? await request(`/memos/${state.selectedMemoId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await request('/memos', { method: 'POST', body: JSON.stringify(payload) });
  } catch (error) {
    setOperationFeedback('memoSaveFeedback', `保存失败：${error.message}`);
    return;
  } finally {
    state.memoSaveBusy = false;
    button.disabled = false;
    button.textContent = originalLabel;
  }
  if (shouldClearQuickDraft && $('quickMemoTitle')) $('quickMemoTitle').value = '';
  closeMemoModal();
  try {
    await syncMemoMutationOrReload(data);
  } catch (error) {
    alert(`已保存，但刷新列表失败：${error.message}`);
  }

  // 严格维持保存前的页面视口位置与日历格列表位置，彻底杜绝回弹顶层
  const restoreScroll = () => {
    if (targetDateKey) {
      const updatedDayMemosEl = $(`dayMemos-${targetDateKey}`);
      if (updatedDayMemosEl && dayMemosScrollTop > 0) {
        updatedDayMemosEl.scrollTop = dayMemosScrollTop;
      }
    }
    if ((window.scrollY ?? window.pageYOffset ?? 0) !== pageScrollY || (window.scrollX ?? window.pageXOffset ?? 0) !== pageScrollX) {
      window.scrollTo({ left: pageScrollX, top: pageScrollY, behavior: 'instant' });
    }
  };
  restoreScroll();
  window.requestAnimationFrame(restoreScroll);
  setTimeout(restoreScroll, 50);
}

async function deleteMemo() {
  if (!state.selectedMemoId || !confirm('确认删除这个备忘录？')) return;
  const memoId = state.selectedMemoId;
  const memo = state.memos.find((item) => String(item.id) === String(memoId));
  const targetDateKey = memo?.date;
  const dayMemosEl = targetDateKey ? $(`dayMemos-${targetDateKey}`) : null;
  const dayMemosScrollTop = dayMemosEl ? dayMemosEl.scrollTop : 0;
  const pageScrollX = window.scrollX ?? window.pageXOffset ?? 0;
  const pageScrollY = window.scrollY ?? window.pageYOffset ?? 0;

  await request(`/memos/${memoId}`, { method: 'DELETE' });
  closeMemoModal();
  removeMemosLocally(memoId);

  const restoreScroll = () => {
    if (targetDateKey) {
      const updatedDayMemosEl = $(`dayMemos-${targetDateKey}`);
      if (updatedDayMemosEl && dayMemosScrollTop > 0) {
        updatedDayMemosEl.scrollTop = dayMemosScrollTop;
      }
    }
    if ((window.scrollY ?? window.pageYOffset ?? 0) !== pageScrollY || (window.scrollX ?? window.pageXOffset ?? 0) !== pageScrollX) {
      window.scrollTo({ left: pageScrollX, top: pageScrollY, behavior: 'instant' });
    }
  };
  restoreScroll();
  window.requestAnimationFrame(restoreScroll);
  setTimeout(restoreScroll, 50);
}

function openDailyDetailModal(date) {
  const targetDate = date instanceof Date ? date : new Date(date);
  state.dailyDetailDate = targetDate;
  const key = dateKey(targetDate);
  const memos = getCalendarMemos().filter((memo) => memo.date === key);

  // 如果当天尚无任何备忘录，直接自动展开“添加详细备忘录”弹窗，跳过多余的空白中转窗
  if (memos.length === 0) {
    openMemoModal(null, targetDate);
    return;
  }

  const dateStr = `${targetDate.getFullYear()}年${targetDate.getMonth() + 1}月${targetDate.getDate()}日`;
  const dateTitle = $('dailyDetailDate');
  if (dateTitle) dateTitle.textContent = dateStr;
  loadDailyDetailMemos(targetDate);
  showDialog('dailyDetailModal', 'quickMemoTitle');
}

function closeDailyDetailModal() {
  hideDialog('dailyDetailModal');
}

function getWeekRange(refDate = new Date()) {
  const d = new Date(refDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);

  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  nextSunday.setHours(23, 59, 59, 999);

  return { monday, sunday, nextMonday, nextSunday };
}

function getWeekInfo(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return { year, number: Math.ceil((((date - yearStart) / 86400000) + 1) / 7) };
}

function formatMemoDue(m) {
  if (!m.dueTime) return '18:00';
  const d = new Date(m.dueTime);
  if (Number.isNaN(d.getTime())) return '18:00';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function weeklyDataRequest() {
  const { monday, nextMonday, nextSunday } = getWeekRange(state.weeklyPlanDate);
  const startMonth = monthKey(monday);
  const months = (nextSunday.getFullYear() - monday.getFullYear()) * 12
    + nextSunday.getMonth() - monday.getMonth() + 1;
  const userId = canManageWorkspace() ? 'all' : String(state.user?.id || '');
  return { monday, nextMonday, nextSunday, startMonth, months, userId,
    key: `${dateKey(monday)}:${startMonth}:${months}:${userId}` };
}

async function loadWeeklyPlanData({ force = false } = {}) {
  if (state.activeView !== 'weeklyPlan') return;
  const { monday, startMonth, months, userId, key } = weeklyDataRequest();
  if (!force && (state.weeklyDataRangeKey === key || state.weeklyDataLoadingKey === key)) return;
  const version = ++state.weeklyRequestVersion;
  state.weeklyRequestController?.abort();
  const controller = new AbortController();
  state.weeklyRequestController = controller;
  state.weeklyDataLoadingKey = key;
  state.weeklyDataErrorKey = '';
  state.weeklyDataError = '';
  const refreshIcon = $('wpPageRefreshBtn')?.querySelector('i');
  if (refreshIcon) refreshIcon.classList.add('fa-spin');
  try {
    const params = new URLSearchParams({ startMonth, months: String(months), userId });
    const summariesParams = new URLSearchParams({
      startWeek: dateKey(monday), weeks: '2', userId
    });
    const [memoData, summaryData] = await Promise.all([
      request(`/memos?${params}`, { signal: controller.signal }),
      request(`/memos/weekly-summaries?${summariesParams}`, { signal: controller.signal })
    ]);
    if (version !== state.weeklyRequestVersion || state.activeView !== 'weeklyPlan') return;
    if (!Array.isArray(memoData.memos) || !Array.isArray(summaryData.summaries)) {
      throw new Error('周计划数据格式无效');
    }
    state.weeklyMemos = sortMemosForCalendar(memoData.memos);
    state.weeklySummaries = summaryData.summaries;
    state.weeklyDataRangeKey = key;
  } catch (error) {
    if (error.name === 'AbortError' || version !== state.weeklyRequestVersion) return;
    state.weeklyDataErrorKey = key;
    state.weeklyDataError = error.message || '加载失败';
  } finally {
    if (version === state.weeklyRequestVersion) {
      state.weeklyDataLoadingKey = '';
      state.weeklyRequestController = null;
      if (refreshIcon) refreshIcon.classList.remove('fa-spin');
      renderWeeklyPlanPage();
    }
  }
}

function shiftWeeklyPlanWeek(offset) {
  const cur = new Date(state.weeklyPlanDate || new Date());
  cur.setDate(cur.getDate() + offset * 7);
  state.weeklyPlanDate = cur;
  state.weeklyMobileDay = null;
  renderWeeklyPlanPage();
}

function setWeeklyPlanToCurrentWeek() {
  state.weeklyPlanDate = new Date();
  state.weeklyMobileDay = null;
  renderWeeklyPlanPage();
}

function switchWeeklyPlanView(view) {
  state.weeklyPlanView = view;
  $('wpPageViewPersonalBtn')?.classList.toggle('active', view === 'personal');
  $('wpPageViewTeamBtn')?.classList.toggle('active', view === 'team');
  renderWeeklyPlanPage();
}

function showWeeklyFeedback(message, type = 'success') {
  const container = $('wpWorkspaceBody');
  if (!container) return;
  const old = container.querySelector('.wp-feedback-toast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.className = `wp-feedback-toast operation-feedback ${type}`;
  toast.style.margin = '0 0 14px';
  toast.innerHTML = `<i class="fas fa-check-circle"></i> ${escapeHtml(message)}`;
  container.prepend(toast);
  setTimeout(() => toast.remove(), 3500);
}

function getWeeklyTargetUserId() {
  if (canManageWorkspace() && state.selectedUserId && state.selectedUserId !== 'all') {
    return Number(state.selectedUserId);
  }
  return Number(state.user?.id);
}

function weeklySummaryFor(ownerId, weekStart) {
  return state.weeklySummaries.find(s => Number(s.ownerId) === Number(ownerId) && s.weekStart === weekStart)
    || { ownerId, weekStart, goals: '', deliverables: '', actual: '', risks: '' };
}

function renderWeeklyMilestoneBar(ownerId, weekStart) {
  const summary = weeklySummaryFor(ownerId, weekStart);
  const hasGoals = Boolean(summary.goals?.trim());
  const hasDeliverables = Boolean(summary.deliverables?.trim());

  if (hasGoals || hasDeliverables) {
    const goalSummary = summary.goals ? summary.goals.split('\n')[0] : '';
    const deliverableSummary = summary.deliverables ? summary.deliverables.split('\n')[0] : '';
    return `
      <div class="wp-milestone-bar has-content" onclick="openWeeklySummaryDialog()" title="点击编辑本周目标、交付物与复盘">
        <div class="wp-milestone-content">
          <div class="wp-milestone-pill goal">
            <span class="wp-pill-badge"><i class="fas fa-flag"></i> 目标</span>
            <span class="wp-pill-text">${escapeHtml(goalSummary)}</span>
          </div>
          ${hasDeliverables ? `
          <div class="wp-milestone-pill deliverable">
            <span class="wp-pill-badge deliverable"><i class="fas fa-box-open"></i> 交付物</span>
            <span class="wp-pill-text">${escapeHtml(deliverableSummary)}</span>
          </div>
          ` : ''}
        </div>
        <button type="button" class="wp-milestone-btn" onclick="event.stopPropagation();openWeeklySummaryDialog()">
          <i class="fas fa-pen"></i> 编辑复盘
        </button>
      </div>`;
  }

  return `
    <div class="wp-milestone-bar is-empty wp-goal-lock-banner" title="请先设定本周目标，才能添加每日计划">
      <div class="wp-goal-lock-left">
        <span class="wp-goal-lock-icon"><i class="fas fa-lock"></i></span>
        <div class="wp-goal-lock-text">
          <strong>尚未设定本周目标</strong>
          <span>请先填写本周核心目标与交付物，才能开始排列每日计划</span>
        </div>
      </div>
      <button type="button" class="wp-goal-set-cta" onclick="openWeeklySummaryDialog()">
        <i class="fas fa-bullseye"></i> 立即设定目标与交付
      </button>
    </div>`;
}

function openWeeklySummaryDialog() {
  const targetUserId = getWeeklyTargetUserId();
  const { monday, sunday } = getWeekRange(state.weeklyPlanDate);
  const monKey = dateKey(monday);
  const sunKey = dateKey(sunday);
  const weekInfo = getWeekInfo(monday);
  const summary = weeklySummaryFor(targetUserId, monKey);

  const periodElem = $('wpSummaryPeriod');
  if (periodElem) {
    periodElem.textContent = `${weekInfo.year}年 第${weekInfo.number}周 (${monKey} ~ ${sunKey})`;
  }
  const fGoals = $('wpFieldGoals');
  const fDeliv = $('wpFieldDeliverables');
  const fActual = $('wpFieldActual');
  const fRisks = $('wpFieldRisks');
  if (fGoals) fGoals.value = summary.goals || '';
  if (fDeliv) fDeliv.value = summary.deliverables || '';
  if (fActual) fActual.value = summary.actual || '';
  if (fRisks) fRisks.value = summary.risks || '';

  const dialog = $('wpSummaryDialog');
  if (dialog) {
    setupDialogBackdropClose('wpSummaryDialog');
    dialog.showModal();
    fGoals?.focus();
  }
}

async function saveWeeklySummaryFromDialog() {
  const targetUserId = getWeeklyTargetUserId();
  const { monday } = getWeekRange(state.weeklyPlanDate);
  const monKey = dateKey(monday);
  const payload = {
    ownerId: targetUserId,
    goals: $('wpFieldGoals')?.value.trim() || '',
    deliverables: $('wpFieldDeliverables')?.value.trim() || '',
    actual: $('wpFieldActual')?.value.trim() || '',
    risks: $('wpFieldRisks')?.value.trim() || ''
  };

  const saveBtn = $('wpSaveSummaryBtn');
  const originalText = saveBtn ? saveBtn.textContent : '保存目标与复盘';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
  }

  try {
    const data = await request(`/memos/weekly-summaries/${monKey}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    state.weeklySummaries = state.weeklySummaries.filter(s =>
      !(Number(s.ownerId) === Number(targetUserId) && s.weekStart === monKey));
    state.weeklySummaries.push(data.summary);
    $('wpSummaryDialog')?.close();
    renderWeeklyPlanPage();
    showWeeklyFeedback('本周目标与复盘已保存');
  } catch (err) {
    alert(`保存失败：${err.message}`);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  }
}

function selectWeeklyMobileDay(index) {
  if (!Number.isInteger(index) || index < 0 || index > 6) return;
  state.weeklyMobileDay = index;
  renderWeeklyPlanPage();
}

function renderWeeklyPlanPage() {
  const page = $('weeklyPlanPage');
  if (!page || state.activeView !== 'weeklyPlan') return;

  const { monday, sunday, nextMonday, nextSunday } = getWeekRange(state.weeklyPlanDate);
  const weekInfo = getWeekInfo(monday);
  const monKey = dateKey(monday);
  const sunKey = dateKey(sunday);
  const nextMonKey = dateKey(nextMonday);
  const nextSunKey = dateKey(nextSunday);

  const weekLabel = $('wpPageWeekLabel');
  if (weekLabel) {
    weekLabel.textContent = `${weekInfo.year}年 第${weekInfo.number}周 (${monday.getMonth() + 1}/${monday.getDate()} ~ ${sunday.getMonth() + 1}/${sunday.getDate()})`;
  }

  const viewToggle = $('wpPageViewToggle');
  if (viewToggle) {
    viewToggle.style.display = canManageWorkspace() ? 'inline-flex' : 'none';
    $('wpPageViewPersonalBtn')?.classList.toggle('active', state.weeklyPlanView === 'personal');
    $('wpPageViewTeamBtn')?.classList.toggle('active', state.weeklyPlanView === 'team');
  }

  const copyBtn = $('wpPageCopyReportBtn');
  if (copyBtn) {
    copyBtn.style.display = (state.weeklyPlanView === 'team') ? 'none' : 'inline-flex';
  }

  const workspaceBody = $('wpWorkspaceBody');
  const statsGroup = $('wpPageStatsGroup');
  if (!workspaceBody) return;
  const requestKey = weeklyDataRequest().key;
  if (state.weeklyDataRangeKey !== requestKey && state.weeklyDataLoadingKey !== requestKey) {
    void loadWeeklyPlanData();
  }

  // Ensure weeklyMemos is seeded from cached state.memos so rendering is 0ms instant
  if (!state.weeklyMemos || state.weeklyMemos.length === 0) {
    const start = dateKey(monday);
    const end = dateKey(nextSunday);
    state.weeklyMemos = state.memos.filter(m => m.date >= start && m.date <= end);
  }

  const targetUserId = getWeeklyTargetUserId();
  const teamView = state.weeklyPlanView === 'team' && canManageWorkspace();
  const userMemos = state.weeklyMemos.filter(m => Number(m.ownerId) === targetUserId);
  const scopedMemos = teamView ? state.weeklyMemos : userMemos;
  const thisWeekMemos = scopedMemos.filter(m => m.planKind === 'plan' && m.date >= monKey && m.date <= sunKey);
  const nextWeekMemos = scopedMemos.filter(m => m.planKind === 'plan' && m.date >= nextMonKey && m.date <= nextSunKey);

  const completed = thisWeekMemos.filter(m => m.completed);
  const open = thisWeekMemos.filter(m => !m.completed && !m.rolloverToId);
  const overdue = open.filter(m => m.dueTime && new Date(m.dueTime).getTime() < Date.now());
  const rolledOver = thisWeekMemos.filter(m => m.rolloverToId);
  const planRate = thisWeekMemos.length
    ? `${Math.round((completed.length / thisWeekMemos.length) * 100)}%` : '—';

  // 顶部卡片内紧凑指标状态条（无多余大卡片侵占视线）
  if (statsGroup) {
    statsGroup.innerHTML = `
      <span class="wp-stat-chip total" title="本周计划数"><i class="fas fa-tasks"></i> 计划 <strong>${thisWeekMemos.length}</strong><span class="hide-mobile"> 项</span></span>
      <span class="wp-stat-chip done" title="已完成计划数"><i class="fas fa-check-circle"></i> 完成 <strong>${completed.length}</strong></span>
      ${open.length ? `<span class="wp-stat-chip pending" title="尚未完成的计划"><i class="fas fa-clock"></i> 待办 <strong>${open.length}</strong></span>` : ''}
      ${overdue.length ? `<span class="wp-stat-chip pending" title="已过截止时间"><i class="fas fa-exclamation-circle"></i> 逾期 <strong>${overdue.length}</strong></span>` : ''}
      ${rolledOver.length ? `<span class="wp-stat-chip" title="保留原记录的顺延计划">顺延 <strong>${rolledOver.length}</strong></span>` : ''}
      <span class="wp-stat-chip rate" title="本周计划完成率；无计划时不计算"><i class="fas fa-chart-line"></i> 达成 <strong>${planRate}</strong></span>
      <span class="wp-stat-chip next" title="下周已预排计划数"><i class="far fa-calendar-check"></i> <span class="hide-mobile">下周</span>预排 <strong>${nextWeekMemos.length}</strong></span>
    `;
  }

  if (teamView) {
    renderTeamWeeklyPlanView(workspaceBody, monKey, sunKey);
    return;
  }

  // Personal View: Generate 7 Days columns (Monday through Sunday)
  const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dKey = dateKey(d);
    const isToday = (dKey === dateKey(new Date()));
    const dMemos = userMemos.filter(m => m.date === dKey);
    weekDays.push({
      dateKey: dKey,
      dayName: dayNames[i],
      dateLabel: `${d.getMonth() + 1}/${d.getDate()}`,
      isToday,
      memos: dMemos
    });
  }

  const todayIndex = weekDays.findIndex(day => day.isToday);
  const mobileDayIndex = state.weeklyMobileDay ?? (todayIndex >= 0 ? todayIndex : 0);
  const boardEmpty = weekDays.every(day => day.memos.length === 0);

  // 互锁：必须先设置本周目标才允许添加每日计划
  const thisWeekSummary = weeklySummaryFor(targetUserId, monKey);
  const hasGoals = Boolean(thisWeekSummary.goals?.trim());

  // Only overdue plans are called out; future plans remain ordinary pending work.
  const personalOverdue = overdue.filter(m => Number(m.ownerId) === targetUserId);
  const rolloverBannerHtml = personalOverdue.length > 0 ? `
    <div class="wp-rollover-banner">
      <div class="wp-rollover-banner-head">
        <div class="wp-rollover-banner-title">
          <i class="fas fa-exclamation-circle text-warning"></i>
          <span>本周有 <strong>${personalOverdue.length}</strong> 项计划已逾期：</span>
        </div>
        <button type="button" class="wp-rollover-batch-btn" onclick="rollOverAllPendingToNextWeek()" title="将本周未完成的全部事项一键顺延流转至下周一">
          <i class="fas fa-angle-double-right"></i> 全部顺延滚入下周
        </button>
      </div>
      <div class="wp-rollover-banner-chips">
        ${personalOverdue.map(m => `
          <div class="wp-rollover-banner-chip">
            <span class="wp-chip-name" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</span>
            <button type="button" class="wp-chip-action-btn" onclick="rollOverMemoToNextWeek('${m.id}')" title="将此项流转到下周一">
              <i class="fas fa-share"></i> 滚入下周
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  workspaceBody.innerHTML = `
    ${renderWeeklyMilestoneBar(targetUserId, monKey)}
    ${rolloverBannerHtml}
    <div class="wp-board-container">
      <div class="wp-mobile-days" aria-label="选择工作日">
        ${weekDays.map((day, index) => `<button type="button" class="${index === mobileDayIndex ? 'active' : ''}" onclick="selectWeeklyMobileDay(${index})" aria-pressed="${index === mobileDayIndex}">${day.dayName.slice(1)}<small>${day.dateLabel}</small></button>`).join('')}
      </div>
      <div class="wp-columns-grid">
        ${weekDays.map((day, index) => `
          <div class="wp-day-column ${day.isToday ? 'is-today' : ''} ${index === mobileDayIndex ? 'is-mobile-selected' : ''}">
            <div class="wp-day-col-header">
              <div class="wp-day-date-box">
                <span class="wp-day-name">${day.dayName}</span>
                <span class="wp-day-date">${day.dateLabel}</span>
              </div>
              ${day.isToday ? '<span class="wp-today-badge">今日</span>' : ''}
              <span class="wp-day-count-badge">${day.memos.length}项</span>
            </div>

            <div class="wp-day-quick-add${hasGoals ? '' : ' is-locked'}">
              ${hasGoals
                ? `<input type="text" class="wp-day-input" placeholder="+ 添加计划，回车保存" title="回车保存，默认截止18:00" onkeydown="if(event.key==='Enter')addPlanForSpecificDate('${day.dateKey}', this)">`
                : `<button type="button" class="wp-day-locked-hint" onclick="openWeeklySummaryDialog()" title="请先设定本周目标">
                    <i class="fas fa-lock"></i> 请先设定本周目标
                  </button>`
              }
            </div>

            <div class="wp-day-task-list" id="wpDayList-${day.dateKey}">
              ${day.memos.length === 0 ? '<div class="wp-day-empty"><i class="far fa-calendar-plus"></i> 暂无事项</div>' : ''}
              ${day.memos.map(m => `
                <div class="wp-day-task-card ${m.completed ? 'completed' : ''} ${m.rolloverToId ? 'rolled-over' : ''}" style="border-left-color: ${m.color || '#4361ee'};">
                  <div class="wp-day-card-top">
                    <input type="checkbox" class="wp-day-checkbox" ${m.completed ? 'checked' : ''} ${m.rolloverToId ? 'disabled' : ''} onchange="toggleMemoCompleteFromBoard('${m.id}', this.checked)" title="标记完成状态">
                    <span class="wp-day-card-title ${m.completed ? 'completed' : ''}" onclick="openMemoModal('${m.id}')" title="点击查看编辑">${escapeHtml(m.title)}</span>
                  </div>
                  <div class="wp-card-tags">
                    <span class="wp-card-tag ${m.planKind === 'plan' ? 'wp-tag-plan' : 'wp-tag-memo'}">${m.planKind === 'plan' ? '周计划' : '日历'}</span>
                    ${m.rolloverToId ? '<span class="wp-card-tag wp-tag-rollover">已顺延</span>' : ''}
                    ${m.rolloverFromId ? '<span class="wp-card-tag wp-tag-from-rollover">上周顺延</span>' : ''}
                  </div>
                  ${m.contentPreview ? `<div class="wp-day-card-content">${escapeHtml(m.contentPreview.slice(0, 50))}</div>` : ''}
                  <div class="wp-day-card-footer">
                    <span class="wp-day-card-due"><i class="far fa-clock"></i> ${formatMemoDue(m)}</span>
                    <div class="wp-card-actions">
                      <button type="button" class="wp-icon-btn" onclick="openMemoModal('${m.id}')" title="编辑详情"><i class="fas fa-edit"></i></button>
                      ${m.rolloverToId || m.rolloverFromId ? '' : `<button type="button" class="wp-icon-btn text-danger" onclick="deleteMemoFromBoard('${m.id}')" title="删除"><i class="fas fa-trash-alt"></i></button>`}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function addPlanForSpecificDate(dateStr, inputElem) {
  const title = inputElem?.value?.trim();
  if (!title) return;

  const targetUserId = getWeeklyTargetUserId();

  try {
    const res = await request('/memos', {
      method: 'POST',
      body: JSON.stringify({
        title,
        date: dateStr,
        ownerId: targetUserId,
        dueTime: `${dateStr}T18:00:00`,
        color: '#206bc4',
        planKind: 'plan'
      })
    });

    if (res.memo) syncMemosLocally(res.memo);
    inputElem.value = '';
    showWeeklyFeedback(`计划「${title}」已排入 ${dateStr}（默认截止 18:00）`);
  } catch (err) {
    alert(`添加计划失败：${err.message}`);
  }
}

async function toggleMemoCompleteFromBoard(memoId, isCompleted) {
  try {
    const res = await request(`/memos/${memoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: isCompleted })
    });
    if (res.memo) syncMemosLocally(res.memo);
    showWeeklyFeedback(`事项已标记为 ${isCompleted ? '已完成' : '未完成'}`);
  } catch (err) {
    renderWeeklyPlanPage();
    alert(`更新状态失败：${err.message}`);
  }
}

async function deleteMemoFromBoard(memoId) {
  if (!confirm('确定要删除该事项吗？')) return;
  try {
    await request(`/memos/${memoId}`, { method: 'DELETE' });
    removeMemosLocally(memoId);
    showWeeklyFeedback('已删除事项');
  } catch (err) {
    alert(`删除失败：${err.message}`);
  }
}

function rolloverDueTime(memo, targetDate) {
  const d = new Date(memo.dueTime);
  return Number.isNaN(d.getTime())
    ? `${targetDate}T18:00:00`
    : `${targetDate}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

async function submitWeeklyRollover(memo, targetDate, reason) {
  const res = await request(`/memos/${memo.id}/rollover`, {
    method: 'POST',
    body: JSON.stringify({ targetDate, dueTime: rolloverDueTime(memo, targetDate), reason })
  });
  syncMemosLocally([res.original, res.memo]);
  return res;
}

async function rollOverMemoToNextWeek(memoId) {
  try {
    const memo = state.weeklyMemos.find(m => String(m.id) === String(memoId));
    if (!memo) return;
    const { nextMonday } = getWeekRange(state.weeklyPlanDate);
    const targetDate = dateKey(nextMonday);
    const reason = prompt('顺延原因（可留空）', '');
    if (reason === null) return;
    await submitWeeklyRollover(memo, targetDate, reason);
    showWeeklyFeedback(`计划「${memo.title}」已顺延到 ${targetDate}，原计划已保留`);
  } catch (err) {
    alert(`流转失败：${err.message}`);
  }
}

async function rollOverAllPendingToNextWeek() {
  const { monday, sunday, nextMonday } = getWeekRange(state.weeklyPlanDate);
  const monKey = dateKey(monday);
  const sunKey = dateKey(sunday);
  const targetDate = dateKey(nextMonday);

  const targetUserId = getWeeklyTargetUserId();
  const pending = state.weeklyMemos.filter(m =>
    Number(m.ownerId) === targetUserId && m.planKind === 'plan'
    && m.date >= monKey && m.date <= sunKey && !m.completed && !m.rolloverToId
    && m.dueTime && new Date(m.dueTime).getTime() < Date.now());

  if (pending.length === 0) {
    showWeeklyFeedback('没有需要顺延的逾期计划');
    return;
  }

  if (!confirm(`将 ${pending.length} 项逾期计划顺延至 ${targetDate}？原记录会保留供复盘。`)) return;
  const reason = prompt('批量顺延原因（可留空）', '');
  if (reason === null) return;

  let successCount = 0;
  let failedCount = 0;
  for (const memo of pending) {
    try {
      await submitWeeklyRollover(memo, targetDate, reason);
      successCount++;
    } catch (e) {
      failedCount++;
      console.error('Failed to rollover memo', memo.id, e);
    }
  }

  showWeeklyFeedback(`已顺延 ${successCount} 项到 ${targetDate}${failedCount ? `，失败 ${failedCount} 项，请刷新后重试` : ''}`,
    failedCount ? 'warning' : 'success');
}

function buildWeeklyReportMarkdown() {
  const { monday, sunday, nextMonday, nextSunday } = getWeekRange(state.weeklyPlanDate);
  const weekInfo = getWeekInfo(monday);
  const nextWeekInfo = getWeekInfo(nextMonday);
  const monKey = dateKey(monday);
  const sunKey = dateKey(sunday);
  const nextMonKey = dateKey(nextMonday);
  const nextSunKey = dateKey(nextSunday);

  const targetUserId = getWeeklyTargetUserId();
  const userMemos = state.weeklyMemos.filter(m => Number(m.ownerId) === targetUserId && m.planKind === 'plan');
  const thisWeekMemos = userMemos.filter(m => m.date >= monKey && m.date <= sunKey);
  const nextWeekMemos = userMemos.filter(m => m.date >= nextMonKey && m.date <= nextSunKey);

  const completed = thisWeekMemos.filter(m => m.completed);
  const rolledOver = thisWeekMemos.filter(m => !m.completed && m.rolloverToId);
  const pending = thisWeekMemos.filter(m => !m.completed && !m.rolloverToId);
  const planRate = thisWeekMemos.length
    ? `${Math.round((completed.length / thisWeekMemos.length) * 100)}%` : '—';
  const summary = { ...weeklySummaryFor(targetUserId, monKey),
    ...state.weeklySummaryDrafts[`${targetUserId}:${monKey}`] };
  const nextSummary = { ...weeklySummaryFor(targetUserId, nextMonKey),
    ...state.weeklySummaryDrafts[`${targetUserId}:${nextMonKey}`] };
  
  let targetUser = state.user;
  if (canManageWorkspace() && state.selectedUserId && state.selectedUserId !== 'all' && state.users) {
    targetUser = state.users.find(u => Number(u.id) === targetUserId) || state.user;
  }
  const userName = targetUser?.displayName || targetUser?.username || '研发工程师';

  let report = `【${userName} · ${weekInfo.year}年第${weekInfo.number}周研发周报】\n`;
  report += `--------------------------------------------------\n`;
  report += `一、本周目标与交付物\n`;
  report += `  目标：${summary.goals || '待补充'}\n  交付物：${summary.deliverables || '待补充'}\n`;
  report += `\n二、本周执行（计划完成率：${planRate}）\n`;
  if (thisWeekMemos.length === 0) {
    report += `  - 本周无计划项\n`;
  } else {
    completed.forEach((m, idx) => {
      report += `  ${idx + 1}. [已完成] ${m.title} (${m.date})\n`;
    });
    pending.forEach((m, idx) => {
      report += `  ${completed.length + idx + 1}. [待办/未完] ${m.title} (${m.date})\n`;
    });
    rolledOver.forEach((m, idx) => {
      const successor = state.weeklyMemos.find(item => Number(item.id) === Number(m.rolloverToId));
      report += `  ${completed.length + pending.length + idx + 1}. [已顺延] ${m.title} (${m.date})${successor?.rolloverReason ? '，原因：' + successor.rolloverReason : ''}\n`;
    });
  }
  report += `  实际进展及偏差：${summary.actual || '待补充'}\n`;

  report += `\n三、下周重点计划（${nextWeekInfo.year}年第${nextWeekInfo.number}周 ${nextMonKey.slice(5)} - ${nextSunKey.slice(5)}）\n`;
  if (nextSummary.goals) report += `  目标：${nextSummary.goals}\n`;
  if (nextSummary.deliverables) report += `  交付物：${nextSummary.deliverables}\n`;
  if (nextWeekMemos.length === 0) {
    report += `  - 暂未录入下周计划\n`;
  } else {
    nextWeekMemos.forEach((m, idx) => {
      report += `  ${idx + 1}. [计划 ${m.date}] ${m.title}${m.contentPreview ? '（内容：' + m.contentPreview.replace(/\n/g, ' ') + (m.contentLength > m.contentPreview.length ? '…' : '') + '）' : ''}\n`;
    });
  }

  report += `\n四、风险与协同需求\n  ${summary.risks || '待确认'}\n`;
  return report;
}

function setupDialogBackdropClose(dialogId) {
  const dialog = $(dialogId);
  if (!dialog || dialog.dataset.backdropBound) return;
  dialog.dataset.backdropBound = 'true';
  dialog.addEventListener('click', (e) => {
    const rect = dialog.getBoundingClientRect();
    const isInDialog = (
      rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX && e.clientX <= rect.left + rect.width
    );
    if (!isInDialog) {
      dialog.close();
    }
  });
}

async function copyTextToClipboard(text, targetElement = null) {
  // 1. 如果支持现代安全上下文 Clipboard API（HTTPS / localhost），优先调用
  if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn('Clipboard API 写入失败，转用兼容方案:', e);
    }
  }

  // 2. 如果目标 textarea 已在 DOM 中，直接选中文本执行 document.execCommand('copy')
  // 这样在 HTTP 环境（非 HTTPS 公网/局域网 IP）下，通过用户点击手势触发 100% 成功
  if (targetElement && typeof targetElement.select === 'function') {
    try {
      targetElement.focus();
      targetElement.select();
      targetElement.setSelectionRange(0, targetElement.value.length);
      const successful = document.execCommand('copy');
      if (successful) return true;
    } catch (e) {
      console.warn('Target element execCommand 复制失败:', e);
    }
  }

  // 3. 通用离屏临时 textarea 降级方案
  try {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.left = '-9999px';
    helper.style.top = '0';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, text.length);
    const successful = document.execCommand('copy');
    document.body.removeChild(helper);
    if (successful) return true;
  } catch (e) {
    console.warn('Fallback execCommand 复制失败:', e);
  }

  return false;
}

function copyWeeklyReportMarkdown() {
  const dialog = $('wpReportDialog');
  const preview = $('wpReportPreview');
  if (!dialog || !preview) return;
  setupDialogBackdropClose('wpReportDialog');
  preview.value = buildWeeklyReportMarkdown();
  dialog.showModal();
  preview.focus();
}

async function confirmCopyWeeklyReport() {
  const preview = $('wpReportPreview');
  const report = preview?.value || '';
  const btn = $('wpConfirmCopyBtn');
  const originalHtml = btn ? btn.innerHTML : '<i class="fas fa-copy"></i> 复制周报';

  const ok = await copyTextToClipboard(report, preview);
  if (ok) {
    if (btn) {
      btn.innerHTML = '<i class="fas fa-check"></i> 已复制到剪贴板';
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-success');
    }
    showWeeklyFeedback('✔ 周报已成功复制到剪贴板，可直接粘贴提交！');
    setTimeout(() => {
      $('wpReportDialog')?.close();
      if (btn) {
        btn.innerHTML = originalHtml;
        btn.classList.remove('btn-success');
        btn.classList.add('btn-primary');
      }
    }, 600);
  } else {
    // 降级兜底方案：全选框内文本，让用户直接按 Ctrl+C / ⌘+C 即可复制
    if (preview) {
      preview.focus();
      preview.select();
      preview.setSelectionRange(0, report.length);
    }
    showWeeklyFeedback('已全选周报内容，请按 Ctrl+C 快速复制', 'warning');
  }
}

function renderTeamWeeklyPlanView(container, monKey, sunKey) {
  const users = state.users || [];
  const thisWeekMemos = state.weeklyMemos.filter(m =>
    m.planKind === 'plan' && m.date >= monKey && m.date <= sunKey);

  // 生成头像颜色（按用户 ID 确定性取色）
  const avatarColors = ['#4361ee','#7c3aed','#0891b2','#059669','#d97706','#dc2626','#db2777','#0284c7'];
  function getAvatarColor(uid) { return avatarColors[Number(uid) % avatarColors.length]; }
  function getInitials(u) {
    const name = u.displayName || u.username || '?';
    return name.slice(0, 2);
  }

  container.innerHTML = `
    <div class="wp-team-header">
      <div class="wp-team-header-left">
        <i class="fas fa-users-cog"></i>
        <div>
          <h3>团队本周执行看板</h3>
          <span>${monKey} — ${sunKey}</span>
        </div>
      </div>
      <div class="wp-team-header-stats">
        <div class="wp-team-hstat">
          <span>${users.length}</span>
          <small>成员</small>
        </div>
        <div class="wp-team-hstat">
          <span>${thisWeekMemos.length}</span>
          <small>计划总数</small>
        </div>
        <div class="wp-team-hstat">
          <span>${thisWeekMemos.filter(m => m.completed).length}</span>
          <small>已完成</small>
        </div>
      </div>
    </div>
    <div class="wp-team-grid">
      ${users.map(u => {
        const uMemos = thisWeekMemos.filter(m => Number(m.ownerId) === Number(u.id));
        const summary = weeklySummaryFor(u.id, monKey);
        const done = uMemos.filter(m => m.completed).length;
        const overdueCount = uMemos.filter(m => !m.completed && !m.rolloverToId
          && m.dueTime && new Date(m.dueTime).getTime() < Date.now()).length;
        const total = uMemos.length;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const hasGoal = Boolean(summary.goals?.trim());
        const color = getAvatarColor(u.id);
        const statusClass = !hasGoal ? 'no-goal' : overdueCount ? 'has-overdue' : done === total && total > 0 ? 'all-done' : 'in-progress';
        const statusLabel = !hasGoal ? '未设目标' : overdueCount ? `${overdueCount} 项逾期` : done === total && total > 0 ? '全部完成' : '进行中';
        const statusIcon = !hasGoal ? 'fa-minus-circle' : overdueCount ? 'fa-exclamation-circle' : done === total && total > 0 ? 'fa-check-circle' : 'fa-spinner';

        return `
          <div class="wp-team-card wp-team-status-${statusClass}">
            <div class="wp-team-card-head">
              <div class="wp-team-avatar" style="background:${color}">${getInitials(u)}</div>
              <div class="wp-team-user-info">
                <strong>${escapeHtml(u.displayName || u.username)}</strong>
                <span>${escapeHtml(u.jobTitle || '工程师')}</span>
              </div>
              <div class="wp-team-status-badge wp-team-status-${statusClass}">
                <i class="fas ${statusIcon}"></i> ${statusLabel}
              </div>
            </div>

            ${hasGoal ? `
            <div class="wp-team-goals-row">
              <div class="wp-team-goal-item">
                <span class="wp-team-goal-label"><i class="fas fa-flag"></i> 目标</span>
                <span class="wp-team-goal-val">${escapeHtml((summary.goals || '').split('\n')[0])}</span>
              </div>
              ${summary.deliverables ? `
              <div class="wp-team-goal-item">
                <span class="wp-team-goal-label"><i class="fas fa-box"></i> 交付</span>
                <span class="wp-team-goal-val">${escapeHtml(summary.deliverables.split('\n')[0])}</span>
              </div>` : ''}
            </div>` : `<div class="wp-team-no-goal"><i class="fas fa-exclamation-triangle"></i> 本周暂未设定目标</div>`}

            <div class="wp-team-progress-row">
              <div class="wp-team-progress-bar">
                <div class="wp-team-progress-fill" style="width:${pct}%;background:${color}"></div>
              </div>
              <span class="wp-team-progress-label">${done}/${total} 完成 ${pct}%</span>
            </div>

            <div class="wp-team-task-pills">
              ${total === 0
                ? '<span class="wp-team-no-tasks">本周暂无计划</span>'
                : uMemos.map(m => {
                    const cls = m.completed ? 'done' : m.rolloverToId ? 'rolled' : !m.completed && m.dueTime && new Date(m.dueTime).getTime() < Date.now() ? 'overdue' : 'open';
                    const icon = m.completed ? 'fa-check' : m.rolloverToId ? 'fa-share' : cls === 'overdue' ? 'fa-exclamation' : 'fa-circle';
                    return `<span class="wp-team-pill wp-team-pill-${cls}" title="${escapeHtml(m.title)} · ${m.date}">
                      <i class="fas ${icon}"></i> ${escapeHtml(m.title.length > 18 ? m.title.slice(0, 18) + '…' : m.title)}
                    </span>`;
                  }).join('')
              }
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}


window.openWeeklyPlanPage = openWeeklyPlanPage;
window.closeWeeklyPlanPage = closeWeeklyPlanPage;
window.shiftWeeklyPlanWeek = shiftWeeklyPlanWeek;
window.setWeeklyPlanToCurrentWeek = setWeeklyPlanToCurrentWeek;
window.switchWeeklyPlanView = switchWeeklyPlanView;
window.rollOverMemoToNextWeek = rollOverMemoToNextWeek;
window.rollOverAllPendingToNextWeek = rollOverAllPendingToNextWeek;
window.addPlanForSpecificDate = addPlanForSpecificDate;
window.toggleMemoCompleteFromBoard = toggleMemoCompleteFromBoard;
window.deleteMemoFromBoard = deleteMemoFromBoard;
window.copyWeeklyReportMarkdown = copyWeeklyReportMarkdown;
window.confirmCopyWeeklyReport = confirmCopyWeeklyReport;
window.saveWeeklySummary = saveWeeklySummaryFromDialog;
window.openWeeklySummaryDialog = openWeeklySummaryDialog;
window.saveWeeklySummaryFromDialog = saveWeeklySummaryFromDialog;
window.selectWeeklyMobileDay = selectWeeklyMobileDay;
window.loadWeeklyPlanData = loadWeeklyPlanData;

function getCountdown(memo) {
  if (!memo.dueTime || memo.completed) return '';
  const dueDate = new Date(memo.dueTime);
  const now = new Date();
  const daysDiff = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
  if (daysDiff < 0) return `<span class="countdown danger">已过期 ${Math.abs(daysDiff)} 天</span>`;
  if (daysDiff === 0) return '<span class="countdown danger">今天到期</span>';
  if (daysDiff <= 3) return `<span class="countdown warning">${daysDiff} 天后到期</span>`;
  return `<span class="countdown success">${daysDiff} 天后到期</span>`;
}

function createTaskItem(memo) {
  let dueDateText = '无截止时间';
  if (memo.dueTime) {
    const d = new Date(memo.dueTime);
    if (!Number.isNaN(d.getTime())) {
      dueDateText = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  const content = String(memo.contentPreview ?? memo.content ?? '');
  const contentPreview = content
    ? `${content.replace(new RegExp('[#*`]', 'g'), '').slice(0, 60)}${Number(memo.contentLength || content.length) > 60 ? '...' : ''}`
    : '无内容';
  const itemColor = memo.completed ? '#94a3b8' : (memo.color || '#4361ee');
  const statusBadge = memo.completed
    ? '<span class="task-status-pill completed"><i class="fas fa-check-circle"></i> 已完成</span>'
    : '<span class="task-status-pill pending"><i class="fas fa-clock"></i> 进行中</span>';
  return `
    <div class="task-item ${memo.completed ? 'completed' : ''}" style="border-left-color:${itemColor}">
      <div class="task-header">
        <div class="task-title ${memo.completed ? 'completed' : ''}">
          ${escapeHtml(memoFullTitle(memo))}
          ${statusBadge}
        </div>
        <div class="task-color" style="background-color:${itemColor}"></div>
      </div>
      <div class="task-due">
        <i class="far fa-clock"></i> <span class="task-time-exact">${dueDateText}</span> ${getCountdown(memo)}
      </div>
      <div class="task-content">${escapeHtml(contentPreview)}</div>
      <div class="task-actions">
        <button class="task-btn task-btn-complete" data-id="${memo.id}">
          ${memo.completed ? '<i class="fas fa-undo"></i> 标记为未完成' : '<i class="fas fa-check"></i> 标记为完成'}
        </button>
        <button class="task-btn task-btn-edit" data-id="${memo.id}">
          <i class="fas fa-edit"></i> 编辑
        </button>
        <button class="task-btn task-btn-delete" data-id="${memo.id}">
          <i class="fas fa-trash"></i> 删除
        </button>
      </div>
    </div>
  `;
}

function loadDailyDetailMemos(date) {
  const key = dateKey(date);
  const list = $('dailyDetailList');
  const memos = getCalendarMemos().filter((memo) => memo.date === key);
  list.innerHTML = memos.length
    ? memos.map(createTaskItem).join('')
    : '<div class="empty-state"><i class="fas fa-clipboard"></i><p>这一天还没有备忘录，添加一个吧！</p></div>';
}

function quickAddMemo() {
  openDetailedMemoFromDaily();
}

function openDetailedMemoFromDaily() {
  const draftTitle = $('quickMemoTitle')?.value || '';
  closeDailyDetailModal();
  openMemoModal(null, state.dailyDetailDate, {
    title: draftTitle,
    fromQuickAdd: Boolean(draftTitle.trim())
  });
}

function openFunctionsModal(tab = 'taskPublish') {
  if (!canManageWorkspace()) return;
  setOperationFeedback('taskPublishFeedback', '');
  setActiveTab(tab);
  showDialog('functionsModal', 'closeFunctionsModal');
  const body = document.querySelector('#functionsModal .modal-body');
  if (body) body.scrollTop = 0;
  revealActiveFunctionsTab();
}

function closeFunctionsModal() {
  hideDialog('functionsModal');
}

function revealActiveFunctionsTab() {
  const tabs = document.querySelector('#functionsModal .tabs');
  const active = tabs?.querySelector('.tab.active');
  if (!active) return;
  const targetLeft = active.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft - 8;
  tabs.scrollLeft = Math.max(0, targetLeft);
}

function setActiveTab(tabName) {
  if (!canManageWorkspace()) return;
  if (tabName === 'opsMonitor' && state.user?.role !== 'admin') return;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
  if ($('functionsModal').classList.contains('active')) revealActiveFunctionsTab();
  const content = $(`${tabName}Tab`);
  if (content) content.classList.add('active');
  if (tabName === 'dataManagement') {
    updateStats();
    renderExcelExportPanel();
  }
  if (tabName === 'userManagement') renderUserManagement();
  if (tabName === 'opsMonitor') refreshOpsStatus();
  if (tabName === 'taskPublish') {
    state.selectedTaskColor = randomMemoColor(latestMemoColor());
    renderTaskAssignees();
    renderColorOptions(state.selectedTaskColor, 'task');
    const today = new Date();
    const end = new Date();
    end.setDate(today.getDate() + 7);
    $('taskStartDate').value = dateKey(today);
    $('taskEndDate').value = dateKey(end);
  }
}

async function publishTask() {
  if (!canManageWorkspace() || state.taskPublishBusy) return;
  const title = $('taskTitle').value.trim();
  const start = $('taskStartDate').value;
  const end = $('taskEndDate').value;
  const taskDueTime = $('taskDueTime').value;
  const assigneeIds = selectedTaskAssigneeIds();

  if (!title || !start || !end) {
    alert('请填写任务标题和日期范围');
    return;
  }

  if (!assigneeIds.length) {
    alert('请选择至少一个接收人');
    return;
  }

  if (!taskDueTime) {
    alert('请添加每日截止时间后再发布');
    $('taskDueTime').focus();
    return;
  }

  if (end < start) {
    setOperationFeedback('taskPublishFeedback', '结束日期不能早于开始日期');
    $('taskEndDate').focus();
    return;
  }
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const startDate = new Date(startYear, startMonth - 1, startDay);
  const endDate = new Date(endYear, endMonth - 1, endDay);
  if (dateKey(startDate) !== start || dateKey(endDate) !== end) {
    setOperationFeedback('taskPublishFeedback', '日期范围无效，请重新选择');
    return;
  }
  const tasks = [];
  const content = $('taskDescription').value;
  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    for (const ownerId of assigneeIds) {
      tasks.push({
        ownerId,
        date: dateKey(date),
        dueTime: `${dateKey(date)}T${taskDueTime}`
      });
    }
  }
  if (!confirm(`将向 ${assigneeIds.length} 人、按 ${tasks.length / assigneeIds.length} 天发布，共创建 ${tasks.length} 条任务。确认继续？`)) return;
  const button = $('publishTask');
  const originalLabel = button.innerHTML;
  state.taskPublishBusy = true;
  button.disabled = true;
  button.textContent = '发布中…';
  setOperationFeedback('taskPublishFeedback', '');
  try {
    const results = await runWithConcurrency(tasks, 4, async (task) => {
      try {
        const data = await request('/memos', {
          method: 'POST',
          body: JSON.stringify({
            ownerId: task.ownerId,
            date: task.date,
            title,
            content,
            color: state.selectedTaskColor,
            dueTime: task.dueTime
          })
        });
        return data.memo ? { task, memo: data.memo } : { task, error: '服务器未返回新任务' };
      } catch (error) {
        return { task, error: error.message || '请求失败' };
      }
    });
    const saved = results.map((result) => result.memo).filter(Boolean);
    const failed = results.filter((result) => result.error);
    if (saved.length) await syncMemoMutationOrReload({ memos: saved });
    if (failed.length) {
      const details = failed.map(({ task, error }) => {
        const owner = state.users.find((user) => Number(user.id) === Number(task.ownerId));
        return `${task.date} / ${owner?.displayName || task.ownerId}：${error}`;
      });
      setOperationFeedback('taskPublishFeedback', `已发布 ${saved.length} 条，失败 ${failed.length} 条。成功项不会自动回滚，请只补发失败项：\n${details.join('\n')}`);
      return;
    }
    closeFunctionsModal();
    alert(`已向 ${assigneeIds.length} 人发布 ${saved.length} 条任务`);
  } catch (error) {
    setOperationFeedback('taskPublishFeedback', `发布状态未能完整确认：${error.message}。请先核对日历记录，避免重复发布。`);
  } finally {
    state.taskPublishBusy = false;
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
}

function updateRecentTasks() {
  const list = $('recentTasksList');
  if (!list) return;
  const memos = [...getVisibleMemos()]
    .sort((a, b) => new Date(b.updatedAt || b.date) - new Date(a.updatedAt || a.date))
    .slice(0, 10);
  list.innerHTML = memos.length
    ? memos.map(createTaskItem).join('')
    : '<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>暂无任务，点击日历上的日期添加新任务</p></div>';
}

function renderUserManagement() {
  const list = $('userManagementList');
  if (!list) return;
  let users = state.users.filter((user) => user.username !== 'admin');
  if (state.user?.username !== 'admin' && !users.some((user) => Number(user.id) === Number(state.user?.id))) {
    users = [state.user, ...users];
  }
  const canEditRoleDepartment = state.user?.role === 'admin';
  list.innerHTML = users.length
    ? users.map((user) => {
      const isCurrentUser = Number(user.id) === Number(state.user?.id);
      const canEditPassword = canEditRoleDepartment || isCurrentUser;
      return `
      <div class="task-item user-management-item" data-user-id="${user.id}">
        <div class="task-header user-management-header">
          <div>
            <div class="task-title">${escapeHtml(user.displayName)}</div>
            <div class="user-management-meta">
              <span>账号：${escapeHtml(user.username)}</span>
              <span>当前岗位：${escapeHtml(displayUserRole(user))}</span>
              <span>当前角色：${escapeHtml(roleName(user.role))}</span>
              <span>当前部门：${escapeHtml(user.departmentName || '')}</span>
            </div>
          </div>
          ${isCurrentUser ? '<span class="user-management-current">当前账号</span>' : ''}
        </div>
        <div class="user-edit-grid">
          <label>
            <span>岗位</span>
            <select class="user-edit-job" data-user-id="${user.id}">
              ${jobTitles.map((title) => optionHtml(title, title, user.jobTitle || displayUserRole(user))).join('')}
            </select>
          </label>
          <label>
            <span>角色</span>
            <select class="user-edit-role" data-user-id="${user.id}" ${canEditRoleDepartment ? '' : 'disabled'}>
              ${editableRoles.map((role) => optionHtml(role, roleName(role), user.role)).join('')}
            </select>
          </label>
          <label>
            <span>部门</span>
            <input class="user-edit-department" data-user-id="${user.id}" value="${escapeHtml(user.departmentName || '')}" ${canEditRoleDepartment ? '' : 'disabled'}>
          </label>
          <label>
            <span>新密码</span>
            <input class="user-edit-password" data-user-id="${user.id}" type="password" placeholder="留空不修改" ${canEditPassword ? '' : 'disabled'} autocomplete="new-password">
          </label>
        </div>
        <div class="task-actions user-management-actions">
          <button class="task-btn user-save-btn" data-user-id="${user.id}">
            <i class="fas fa-save"></i> 保存修改
          </button>
          <button class="task-btn task-btn-delete user-delete-btn" data-user-id="${user.id}" ${isCurrentUser ? 'disabled' : ''}>
            <i class="fas fa-user-minus"></i> 删除人员
          </button>
        </div>
      </div>
    `;
    }).join('')
    : '<div class="empty-state"><i class="fas fa-users"></i><p>暂无可管理人员</p></div>';
}

async function saveUserById(userId) {
  const card = document.querySelector(`.user-management-item[data-user-id="${Number(userId)}"]`);
  if (!card) return;
  const payload = {
    jobTitle: card.querySelector('.user-edit-job')?.value,
    role: card.querySelector('.user-edit-role')?.value,
    departmentName: card.querySelector('.user-edit-department')?.value.trim(),
    newPassword: card.querySelector('.user-edit-password')?.value.trim()
  };
  if (!payload.jobTitle || !payload.role || !payload.departmentName) {
    alert('岗位、角色、部门都不能为空');
    return;
  }
  await request(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  await loadUsers();
  const updatedCurrentUser = state.users.find((user) => Number(user.id) === Number(state.user?.id));
  if (updatedCurrentUser) {
    state.user = updatedCurrentUser;
    $('serverUserName').textContent = state.user.displayName;
    $('serverUserRole').textContent = `· ${displayUserRole(state.user)} · ${state.user.departmentName}`;
    const avatarEl = $('sidebarUserAvatar');
    if (avatarEl && state.user?.displayName) {
      avatarEl.textContent = state.user.displayName.trim().charAt(0) || '用';
    }
  }
  renderUserManagement();
  renderTaskAssignees();
  alert('人员信息已保存');
}

async function deleteUserById(userId) {
  const user = state.users.find((item) => String(item.id) === String(userId));
  if (!user) return;
  if (!confirm(`确定删除 ${user.displayName} 吗？该人员的备忘录也会一并删除。`)) return;
  await request(`/users/${user.id}`, { method: 'DELETE' });
  await loadUsers();
  await loadMemos();
  renderUserManagement();
  renderTaskAssignees();
}

function dataManagementStats() {
  const memos = getVisibleMemos();
  const completed = memos.filter((memo) => memo.completed).length;
  const pending = memos.length - completed;
  const sortedByDate = [...memos].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const sortedByUpdate = [...memos].sort((a, b) => new Date(b.updatedAt || b.createdAt || b.date) - new Date(a.updatedAt || a.createdAt || a.date));
  return {
    total: memos.length,
    completed,
    pending,
    completionRate: memos.length ? `${Math.round((completed / memos.length) * 100)}%` : '0%',
    oldest: sortedByDate[0]?.date || '无',
    latest: sortedByUpdate[0] ? new Date(sortedByUpdate[0].updatedAt || sortedByUpdate[0].createdAt || sortedByUpdate[0].date).toLocaleString('zh-CN') : '无'
  };
}

function updateStats() {
  const stats = dataManagementStats();
  const map = {
    totalMemos: stats.total,
    completedMemos: stats.completed,
    pendingMemos: stats.pending,
    completionRate: stats.completionRate,
    totalMemosStat: stats.total,
    completedMemosStat: stats.completed,
    pendingMemosStat: stats.pending,
    oldestMemoStat: stats.oldest,
    latestUpdateStat: stats.latest
  };
  Object.entries(map).forEach(([id, value]) => { if ($(id)) $(id).textContent = value; });
}

function opsSummaryCard(icon, title, value, subtitle, level = 'normal') {
  return `
    <div class="ops-card">
      <div class="ops-card-title">
        <span><i class="${icon}"></i> ${escapeHtml(title)}</span>
        <span class="${opsLevelClass(level)}">${opsLevelText(level)}</span>
      </div>
      <div class="ops-card-value">${escapeHtml(value)}</div>
      <div class="ops-card-subtitle">${escapeHtml(subtitle)}</div>
    </div>
  `;
}

function opsInfoRow(label, value) {
  return `<div class="ops-info-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderOpsDisk(disk) {
  const level = disk.level || 'normal';
  return `
    <div class="ops-disk-item">
      <div class="ops-disk-top">
        <span>${escapeHtml(disk.label)} · ${escapeHtml(disk.path)}</span>
        <span>${Number(disk.usedPercent || 0).toFixed(1)}%</span>
      </div>
      <div class="ops-progress">
        <div class="ops-progress-bar ${level === 'normal' ? '' : level}" style="width:${Math.min(100, Number(disk.usedPercent || 0))}%"></div>
      </div>
      <div class="ops-card-subtitle">
        已用 ${formatBytes(disk.usedBytes)} / 总量 ${formatBytes(disk.totalBytes)}，可用 ${formatBytes(disk.availableBytes)}
      </div>
    </div>
  `;
}

function renderOpsStatus() {
  const box = $('opsMonitorContent');
  if (!box) return;
  const data = state.opsStatus;
  if (!data) {
    box.innerHTML = '<div class="empty-state"><i class="fas fa-server"></i><p>点击刷新状态获取服务器信息</p></div>';
    return;
  }

  const runtime = data.runtime || {};
  const memory = runtime.memory || {};
  const database = data.database || {};
  const connectionPool = database.connectionPool || {};
  const processInfo = runtime.process || {};
  box.innerHTML = `
    <div class="ops-status-summary">
      ${opsSummaryCard('fas fa-heartbeat', '总体状态', opsLevelText(data.level), `检查时间：${new Date(data.checkedAt).toLocaleString('zh-CN')}`, data.level)}
      ${opsSummaryCard('fas fa-memory', '内存使用', `${Number(memory.usedPercent || 0).toFixed(1)}%`, `${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`, memory.level)}
      ${opsSummaryCard('fas fa-microchip', '系统负载', `${Number(runtime.loadPercent || 0).toFixed(1)}%`, `${runtime.cpuCount || 0} 核 · 1分钟负载 ${(runtime.loadAverage?.[0] || 0).toFixed(2)}`)}
      ${opsSummaryCard('fas fa-database', '数据库', formatBytes(database.databaseSizeBytes), `${database.userCount || 0} 个用户 · ${database.memoCount || 0} 条任务`)}
    </div>

    <div class="ops-section">
      <h4><i class="fas fa-hdd"></i> 磁盘状态</h4>
      <div class="ops-disk-list">
        ${(data.disks || []).map(renderOpsDisk).join('')}
      </div>
    </div>

    <div class="ops-section">
      <h4><i class="fas fa-server"></i> 运行环境</h4>
      <div class="ops-info-grid">
        ${opsInfoRow('主机名', runtime.hostname || '-')}
        ${opsInfoRow('系统', `${runtime.platform || '-'} ${runtime.arch || ''} ${runtime.release || ''}`)}
        ${opsInfoRow('系统运行时间', formatDuration(runtime.uptimeSeconds))}
        ${opsInfoRow('后端进程运行时间', formatDuration(processInfo.uptimeSeconds))}
        ${opsInfoRow('Node 版本', processInfo.nodeVersion || '-')}
        ${opsInfoRow('后端进程内存', formatBytes(processInfo.memoryUsage?.rss))}
        ${opsInfoRow('数据库连接池', `总 ${connectionPool.totalConnections || 0} · 空闲 ${connectionPool.idleConnections || 0} · 等待 ${connectionPool.waitingRequests || 0}`)}
        ${opsInfoRow('部门数量', String(database.departmentCount || 0))}
        ${opsInfoRow('挂载点', (data.mounts || []).map((item) => item.target).join('、') || '-')}
      </div>
    </div>

    <div class="ops-section">
      <h4><i class="fas fa-info-circle"></i> 说明</h4>
      <ul class="ops-note-list">
        ${(data.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join('')}
      </ul>
    </div>
  `;
}

async function refreshOpsStatus() {
  if (state.user?.role !== 'admin') return;
  const box = $('opsMonitorContent');
  if (box) box.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>正在读取服务器状态...</p></div>';
  try {
    state.opsStatus = await request('/ops/status');
    renderOpsStatus();
  } catch (error) {
    if (box) box.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function reminderMemos() {
  return state.reminders.filter((memo) => !memo.completed);
}

function reminderMemoTitle(memo) {
  const title = memo.title || '无标题';
  if (!canManageWorkspace() || !memo.ownerName) return title;
  return `[${memo.ownerName}] ${title}`;
}

function updateReminderBadge() {
  const now = new Date();
  const count = reminderMemos().filter((memo) => isOverdueMemo(memo, now) || isDueSoonMemo(memo, now) || memo.isUrged).length;
  const badge = $('reminderBadge');
  const bell = $('floatingReminder');
  if (!badge || !bell) return;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.style.display = count ? 'flex' : 'none';
  bell.classList.toggle('reminder-pulse', count > 0);
  bell.setAttribute('aria-label', count ? `提醒中心，${count} 条逾期或待处理事项` : '提醒中心');
}

function getFilteredReminderMemos() {
  const now = new Date();
  const pending = reminderMemos();
  if (state.reminderFilter === 'overdue') {
    return pending.filter((memo) => isOverdueMemo(memo, now));
  }
  if (state.reminderFilter === 'duesoon') {
    return pending.filter((memo) => isDueSoonMemo(memo, now));
  }
  if (state.reminderFilter === 'urged') {
    return pending.filter((memo) => memo.isUrged);
  }
  return pending;
}

function updateReminderTabCounts() {
  const now = new Date();
  const pending = reminderMemos();
  const allCount = pending.length;
  const overdueCount = pending.filter((memo) => isOverdueMemo(memo, now)).length;
  const dueSoonCount = pending.filter((memo) => isDueSoonMemo(memo, now)).length;
  const urgedCount = pending.filter((memo) => memo.isUrged).length;

  if ($('reminderCountAll')) $('reminderCountAll').textContent = allCount;
  if ($('reminderCountOverdue')) $('reminderCountOverdue').textContent = overdueCount;
  if ($('reminderCountDueSoon')) $('reminderCountDueSoon').textContent = dueSoonCount;
  if ($('reminderCountUrged')) $('reminderCountUrged').textContent = urgedCount;

  document.querySelectorAll('#reminderFilterTabs .reminder-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.filter === state.reminderFilter);
  });
}

function updateReminderSelectionUI() {
  const filtered = getFilteredReminderMemos();
  const selectedCount = state.selectedReminderIds.size;
  const totalCount = filtered.length;

  const countEl = $('reminderSelectedCount');
  if (countEl) {
    countEl.textContent = `已选 ${selectedCount} 项`;
  }

  const selectAllCb = $('reminderSelectAll');
  if (selectAllCb) {
    selectAllCb.checked = totalCount > 0 && filtered.every((m) => state.selectedReminderIds.has(String(m.id)));
    selectAllCb.indeterminate = selectedCount > 0 && selectedCount < totalCount;
    selectAllCb.disabled = totalCount === 0;
  }

  const urgeBtn = $('reminderUrgeBtn');
  if (urgeBtn) {
    urgeBtn.style.display = canManageWorkspace() && totalCount > 0 ? 'inline-flex' : 'none';
    urgeBtn.disabled = selectedCount === 0;
    urgeBtn.innerHTML = selectedCount > 0
      ? `<i class="fas fa-bullhorn"></i> 批量催办 (${selectedCount})`
      : '<i class="fas fa-bullhorn"></i> 批量催办';
  }

  const batchCompleteBtn = $('reminderBatchCompleteBtn');
  if (batchCompleteBtn) {
    batchCompleteBtn.style.display = totalCount > 0 ? 'inline-flex' : 'none';
    batchCompleteBtn.disabled = selectedCount === 0;
    batchCompleteBtn.innerHTML = selectedCount > 0
      ? `<i class="fas fa-check-double"></i> 一键完成 (${selectedCount})`
      : '<i class="fas fa-check-double"></i> 一键完成';
  }

  const actionsEl = document.querySelector('.reminder-actions');
  if (actionsEl) {
    actionsEl.style.display = totalCount > 0 ? '' : 'none';
  }
}

function renderReminderList() {
  const now = new Date();
  const filtered = getFilteredReminderMemos();
  updateReminderTabCounts();

  const listEl = $('reminderList');
  if (!listEl) return;

  const errorHtml = state.reminderError ? `<p class="operation-feedback" role="alert">提醒更新失败：${escapeHtml(state.reminderError)}</p>` : '';

  if (!filtered.length) {
    listEl.innerHTML = errorHtml + '<div class="empty-state"><i class="fas fa-check-circle" style="color:var(--ui-success, #10b981)"></i><p>当前分类下暂无事项</p></div>';
    updateReminderSelectionUI();
    return;
  }

  listEl.innerHTML = errorHtml + filtered.map((memo) => {
    const isOverdue = isOverdueMemo(memo, now);
    const isDueSoon = isDueSoonMemo(memo, now);
    const isSelected = state.selectedReminderIds.has(String(memo.id));
    const deadline = memoDeadlineDate(memo);
    const dueFormatted = deadline ? deadline.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : (memo.date || '');
    
    let dueTagHtml = '';
    if (isOverdue) {
      dueTagHtml = '<span class="reminder-due-tag overdue">已逾期</span>';
    } else if (isDueSoon) {
      dueTagHtml = '<span class="reminder-due-tag duesoon">即将到期</span>';
    }

    const urgedBadge = memo.isUrged
      ? '<span class="reminder-badge-urged"><i class="fas fa-fire"></i> 催办中</span>'
      : '';

    return `
      <div class="reminder-item-row ${isSelected ? 'is-selected' : ''} ${isOverdue ? 'is-overdue' : ''} ${memo.isUrged ? 'is-urged' : ''}" data-memo-id="${memo.id}">
        <label class="reminder-item-checkbox-label">
          <input type="checkbox" class="reminder-item-checkbox" data-memo-id="${memo.id}" ${isSelected ? 'checked' : ''}>
        </label>
        <div class="reminder-item-content" data-memo-id="${memo.id}">
          <div class="reminder-item-top">
            <span class="reminder-item-title">${escapeHtml(reminderMemoTitle(memo))}</span>
            ${urgedBadge}
          </div>
          <div class="reminder-item-details">
            <span><i class="far fa-clock"></i> 截止：${escapeHtml(dueFormatted)}</span>
            ${dueTagHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  updateReminderSelectionUI();
}

function toggleReminderSelection(memoId) {
  const idStr = String(memoId);
  if (state.selectedReminderIds.has(idStr)) {
    state.selectedReminderIds.delete(idStr);
  } else {
    state.selectedReminderIds.add(idStr);
  }

  const row = document.querySelector(`.reminder-item-row[data-memo-id="${idStr}"]`);
  if (row) {
    const isSelected = state.selectedReminderIds.has(idStr);
    row.classList.toggle('is-selected', isSelected);
    const cb = row.querySelector('.reminder-item-checkbox');
    if (cb) cb.checked = isSelected;
  }
  updateReminderSelectionUI();
}

function toggleSelectAllReminders(checked) {
  const filtered = getFilteredReminderMemos();
  if (checked) {
    filtered.forEach((m) => state.selectedReminderIds.add(String(m.id)));
  } else {
    filtered.forEach((m) => state.selectedReminderIds.delete(String(m.id)));
  }

  document.querySelectorAll('.reminder-item-row').forEach((row) => {
    const id = row.dataset.memoId;
    const isSelected = state.selectedReminderIds.has(id);
    row.classList.toggle('is-selected', isSelected);
    const cb = row.querySelector('.reminder-item-checkbox');
    if (cb) cb.checked = isSelected;
  });

  updateReminderSelectionUI();
}

function setReminderFilter(filter) {
  state.reminderFilter = filter;
  renderReminderList();
}

async function batchCompleteReminders() {
  const filtered = getFilteredReminderMemos();
  const ids = state.selectedReminderIds.size > 0
    ? Array.from(state.selectedReminderIds).map(Number)
    : filtered.map((m) => Number(m.id));

  if (!ids.length) {
    alert('当前没有待完成的事项');
    return;
  }

  const confirmMsg = state.selectedReminderIds.size > 0
    ? `确定要将勾选的 ${ids.length} 个事项一键标记为已完成吗？`
    : `确定要将当前分类下的全部 ${ids.length} 个事项一键标记为已完成吗？`;

  if (!confirm(confirmMsg)) return;

  const btn = $('reminderBatchCompleteBtn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
  }

  try {
    const res = await request('/memos/batch-complete', {
      method: 'POST',
      body: JSON.stringify({ memoIds: ids })
    });

    state.selectedReminderIds.clear();
    await loadReminders();
    await loadMemos({ force: true });
    renderReminderList();

    const toast = document.createElement('div');
    toast.className = 'operation-feedback success';
    toast.style.margin = '10px 0 0';
    toast.innerHTML = `<i class="fas fa-check-circle"></i> 成功完成 ${res.count || ids.length} 个事项！`;
    $('reminderList')?.prepend(toast);
    setTimeout(() => toast.remove(), 3500);
  } catch (error) {
    alert(`批量完成失败：${error.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function batchUrgeReminders() {
  if (!canManageWorkspace()) return;
  const filtered = getFilteredReminderMemos();
  const ids = state.selectedReminderIds.size > 0
    ? Array.from(state.selectedReminderIds).map(Number)
    : filtered.filter((m) => isOverdueMemo(m, new Date())).map((m) => Number(m.id));

  if (!ids.length) {
    alert('请勾选要催办的任务，或确认列表中是否存在逾期任务');
    return;
  }

  const confirmMsg = state.selectedReminderIds.size > 0
    ? `确定要向工程师客户端下发这 ${ids.length} 个任务的催办提醒通知吗？`
    : `确定要向工程师客户端下发全部 ${ids.length} 个逾期任务的催办提醒通知吗？`;

  if (!confirm(confirmMsg)) return;

  const btn = $('reminderUrgeBtn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 下发中...';
  }

  try {
    const res = await request('/memos/urge', {
      method: 'POST',
      body: JSON.stringify({ memoIds: ids })
    });

    await loadReminders();
    renderReminderList();

    const usersStr = (res.urgedUsers || []).join('、');
    const toast = document.createElement('div');
    toast.className = 'operation-feedback success';
    toast.style.margin = '10px 0 0';
    toast.innerHTML = `<i class="fas fa-bullhorn"></i> 已成功下发催办通知给工程师（${escapeHtml(usersStr || '相关责任人')}）共 ${res.count} 项！`;
    $('reminderList')?.prepend(toast);
    setTimeout(() => toast.remove(), 4500);
  } catch (error) {
    alert(`下发催办通知失败：${error.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

function showReminderModal() {
  renderReminderList();
  showDialog('reminderModal', 'closeReminderModal');
  updateReminderBadge();

  // 若工程师有未读催办通知，打开提醒中心时自动标记已读
  if (state.user?.role !== 'admin' && state.engineerNotifications.length) {
    request('/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) })
      .then(() => {
        state.engineerNotifications = [];
        dismissEngineerUrgeBanner();
      })
      .catch(() => {});
  }
}

function closeReminderModal() {
  hideDialog('reminderModal');
}

function showEngineerUrgeBanner(notifications) {
  let banner = $('engineerUrgeBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'engineerUrgeBanner';
    banner.className = 'engineer-urge-banner';
    document.body.appendChild(banner);
  }
  const count = notifications.length;
  banner.innerHTML = `
    <span><i class="fas fa-bullhorn"></i> 您有 <strong>${count}</strong> 个任务被管理员催办，请尽快处理！</span>
    <button class="close-banner" type="button" title="忽略">&times;</button>
  `;
  banner.style.display = 'flex';

  banner.onclick = (e) => {
    if (e.target.closest('.close-banner')) {
      e.stopPropagation();
      dismissEngineerUrgeBanner();
      return;
    }
    showReminderModal();
  };
}

function dismissEngineerUrgeBanner() {
  const banner = $('engineerUrgeBanner');
  if (banner) banner.style.display = 'none';
}

async function checkEngineerNotifications() {
  if (!state.token || state.user?.role === 'admin') return;
  try {
    const res = await request('/notifications');
    if (Array.isArray(res.notifications) && res.notifications.length) {
      state.engineerNotifications = res.notifications;
      showEngineerUrgeBanner(res.notifications);
    } else {
      state.engineerNotifications = [];
      dismissEngineerUrgeBanner();
    }
  } catch (e) {
    // 忽略静默网络异常
  }
}

function openExcelExportPanel() {
  if (!canManageWorkspace()) {
    exportStaffCalendarExcel();
    return;
  }
  openFunctionsModal('dataManagement');
}

async function exportStaffCalendarExcel() {
  try {
    const months = visibleMonths();
    const startMonth = monthKey(months[0] || state.currentDate);
    const count = String(state.monthsToShow || 1);
    const params = new URLSearchParams({
      startMonth,
      months: count
    });
    const response = await fetch(`${apiBase}/exports/calendar?${params.toString()}`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || '导出失败');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.user?.displayName || '我的'}工作日历_${startMonth}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message || '导出失败');
  }
}

function defaultExcelSelectedUserIds() {
  if (state.selectedUserId === 'all') return state.users.map((user) => String(user.id));
  return [String(state.selectedUserId)];
}

function normalizeExcelSelectedUserIds() {
  const validIds = new Set(state.users.map((user) => String(user.id)));
  const selectedIds = Array.isArray(state.excelSelectedUserIds)
    ? state.excelSelectedUserIds
    : defaultExcelSelectedUserIds();
  state.excelSelectedUserIds = Array.from(new Set(selectedIds.map(String).filter((id) => validIds.has(id))));
}

function renderExcelUserPicker() {
  const picker = $('excelUserPicker');
  const selectionCount = $('excelSelectionCount');
  if (!picker) return;

  normalizeExcelSelectedUserIds();
  const selectedIds = new Set(state.excelSelectedUserIds);
  if (selectionCount) selectionCount.textContent = `已选择 ${selectedIds.size} / ${state.users.length} 人`;

  picker.innerHTML = state.users.length
    ? state.users.map((user) => {
      const id = String(user.id);
      const selected = selectedIds.has(id);
      return `
        <label class="excel-user-option ${selected ? 'selected' : ''}">
          <input type="checkbox" data-excel-user-id="${id}" ${selected ? 'checked' : ''}>
          <span class="excel-user-option-content">
            <span class="excel-user-option-name">${escapeHtml(user.displayName)}</span>
            <span class="excel-user-option-meta">${escapeHtml(displayUserRole(user))} · ${escapeHtml(user.departmentName || '')}</span>
          </span>
        </label>
      `;
    }).join('')
    : '<div class="excel-user-picker-empty">暂无可导出人员</div>';
}

function renderExcelExportPanel() {
  const panel = $('excelExportPanel');
  if (!panel) return;
  const isAdmin = state.user?.role === 'admin';
  panel.hidden = !isAdmin;
  if (!isAdmin) return;

  const startMonth = $('excelStartMonth');
  const monthCount = $('excelMonthCount');
  if (startMonth) startMonth.value = monthKey(state.currentDate);
  if (monthCount) monthCount.value = String(state.monthsToShow);
  renderExcelUserPicker();
}

function selectedExcelUserIds() {
  normalizeExcelSelectedUserIds();
  return [...state.excelSelectedUserIds];
}

function setExcelUserSelected(userId, selected) {
  normalizeExcelSelectedUserIds();
  const id = String(userId);
  const selectedIds = new Set(state.excelSelectedUserIds);
  if (selected) selectedIds.add(id);
  else selectedIds.delete(id);
  state.excelSelectedUserIds = Array.from(selectedIds);
  renderExcelUserPicker();
}

function selectAllExcelUsers() {
  state.excelSelectedUserIds = state.users.map((user) => String(user.id));
  renderExcelUserPicker();
}

function selectCurrentExcelUser() {
  const currentId = state.selectedUserId !== 'all' ? String(state.selectedUserId) : String(state.user?.id || '');
  state.excelSelectedUserIds = currentId ? [currentId] : [];
  renderExcelUserPicker();
}

function clearExcelUserSelection() {
  state.excelSelectedUserIds = [];
  renderExcelUserPicker();
}

async function exportExcelData() {
  if (state.user?.role !== 'admin') {
    alert('只有管理员可以导出 Excel');
    return;
  }

  const startMonth = $('excelStartMonth')?.value || monthKey(state.currentDate);
  const months = $('excelMonthCount')?.value || String(state.monthsToShow);
  const userIds = selectedExcelUserIds();
  if (!userIds.length) {
    alert('请选择至少一个导出人员');
    return;
  }

  const params = new URLSearchParams({
    startMonth,
    months,
    userIds: userIds.join(',')
  });
  const response = await fetch(`${apiBase}/exports/calendar?${params.toString()}`, {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Excel 导出失败');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `工作日历-${startMonth}-${months}个月.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportData() {
  if (!canManageWorkspace()) return;
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: state.selectedUserId,
    memos: getVisibleMemos()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `work-calendar-${dateKey(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData() {
  if (!canManageWorkspace()) return;
  $('importFileInput')?.click();
}

function parseImportMemos(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.memos)) return payload.memos;
  throw new Error('导入文件格式不正确，未找到 memos 数据');
}

function resolveImportedOwnerId(memo) {
  const byId = state.users.find((user) => Number(user.id) === Number(memo.ownerId));
  if (byId) return Number(byId.id);
  const byName = state.users.find((user) => user.displayName === memo.ownerName || user.username === memo.ownerName);
  if (byName) return Number(byName.id);
  if (state.selectedUserId !== 'all') return Number(state.selectedUserId);
  return Number(state.user.id);
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    const memos = parseImportMemos(payload);
    if (!memos.length) {
      alert('导入文件里没有可导入记录');
      return;
    }
    const valid = memos.filter((memo) => String(memo.title || '').trim() && /^\d{4}-\d{2}-\d{2}$/.test(String(memo.date || '').slice(0, 10)));
    const skipped = memos.length - valid.length;
    if (!valid.length) {
      alert(`没有可导入的记录，${skipped} 条缺少标题或有效日期`);
      return;
    }
    if (!confirm(`文件共 ${memos.length} 条；可尝试导入 ${valid.length} 条，跳过 ${skipped} 条。导入会新增记录，不会覆盖或去重。确认继续？`)) return;

    const importedMemos = [];
    const failures = [];
    for (const memo of valid) {
      const title = String(memo.title || '').trim();
      const date = String(memo.date || '').slice(0, 10);
      try {
        const data = await request('/memos', {
          method: 'POST',
          body: JSON.stringify({
            ownerId: resolveImportedOwnerId(memo),
            date,
            title,
            content: memo.content || '',
            color: memo.color || randomMemoColor(latestMemoColor()),
            completed: Boolean(memo.completed),
            dueTime: memo.dueTime || null
          })
        });
        if (data.memo) importedMemos.push(data.memo);
      } catch (error) {
        failures.push(`${date} ${title}：${error.message}`);
      }
    }

    if (importedMemos.length) syncMemosLocally(importedMemos);
    await loadReminders();
    const summary = `导入完成：成功 ${importedMemos.length} 条，跳过 ${skipped} 条，失败 ${failures.length} 条。`;
    alert(failures.length
      ? `${summary}\n已成功的记录不会自动回滚，请勿直接重试整个文件。\n失败项：\n${failures.slice(0, 10).join('\n')}${failures.length > 10 ? '\n…' : ''}`
      : summary);
  } catch (error) {
    alert(`导入失败：${error.message}`);
  }
}

function clearAllData() {
  if (!canManageWorkspace()) return;
  alert('服务器版不支持前端清空全部数据。如需清理，请走管理员后台或数据库备份后处理。');
}

async function completeAllMemosForMonth(month) {
  const targets = getVisibleMemos().filter((memo) => memo.date.startsWith(month) && !memo.completed);
  if (!targets.length) return;
  if (!confirm(`确认将 ${month} 的 ${targets.length} 条备忘录标记为完成？`)) return;
  const results = await runWithConcurrency(targets, 4, (memo) => request(`/memos/${memo.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ completed: true })
  }));
  await syncMemoMutationOrReload({ memos: results.map((result) => result.memo).filter(Boolean) });
}

async function toggleMemoCompletion(memoId) {
  const memo = state.memos.find((item) => String(item.id) === String(memoId));
  if (!memo) return;
  const data = await request(`/memos/${memo.id}`, { method: 'PATCH', body: JSON.stringify({ completed: !memo.completed }) });
  await syncMemoMutationOrReload(data);
}

async function deleteMemoById(memoId) {
  if (!confirm('确定要删除这个备忘录吗？此操作不可撤销。')) return;
  await request(`/memos/${memoId}`, { method: 'DELETE' });
  removeMemosLocally(memoId);
}

function handleDayMemosWheel(event) {
  const list = event.target.closest?.('.day-memos');
  if (!list) return;
  const canScroll = list.scrollHeight > list.clientHeight + 1;
  if (!canScroll) return;

  const delta = event.deltaY;
  const atTop = list.scrollTop <= 0;
  const atBottom = Math.ceil(list.scrollTop + list.clientHeight) >= list.scrollHeight;
  const shouldScrollInside = (delta < 0 && !atTop) || (delta > 0 && !atBottom);
  if (!shouldScrollInside) return;

  event.preventDefault();
  event.stopPropagation();
  list.scrollTop += delta;
}

function initEventListeners() {
  document.addEventListener('keydown', handleDialogKeydown);
  document.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.day-number-text[role="button"]')) {
      event.preventDefault();
      event.target.click();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshMemosInBackground();
  });
  $('saveMemo').addEventListener('click', (event) => {
    event?.preventDefault();
    saveMemo();
  });
  $('deleteMemo').addEventListener('click', (event) => {
    event?.preventDefault();
    deleteMemo();
  });
  $('cancelMemo').addEventListener('click', (event) => {
    event?.preventDefault();
    closeMemoModal();
  });
  $('closeMemoModal').addEventListener('click', (event) => {
    event?.preventDefault();
    closeMemoModal();
  });
  $('memoContent').addEventListener('input', updateMarkdownPreview);
  $('memoContent').addEventListener('keydown', continueOrderedMemoLine);
  $('memoTextToolbar')?.addEventListener('click', handleMemoTextToolbarClick);
  $('memoTabEdit')?.addEventListener('click', () => switchMemoContentTab('edit'));
  $('memoTabPreview')?.addEventListener('click', () => switchMemoContentTab('preview'));
  $('quickDueChips')?.addEventListener('click', handleQuickDueChipClick);
  $('memoCompleted')?.addEventListener('change', syncMemoCompletedState);
  $('closeDailyDetailModal').addEventListener('click', closeDailyDetailModal);
  $('closeDailyDetailModalBtn').addEventListener('click', closeDailyDetailModal);
  $('addNewMemoBtn').addEventListener('click', openDetailedMemoFromDaily);
  $('quickAddMemo').addEventListener('click', quickAddMemo);
  $('quickMemoTitle').addEventListener('keypress', (event) => { if (event.key === 'Enter') quickAddMemo(); });
  $('floatingReminder').addEventListener('click', showReminderModal);
  $('closeReminderModal').addEventListener('click', closeReminderModal);
  $('floatingFunctions').addEventListener('click', () => openFunctionsModal('taskPublish'));
  $('closeFunctionsModal').addEventListener('click', closeFunctionsModal);
  $('closeFunctionsModalBtn').addEventListener('click', closeFunctionsModal);
  $('wpBackToCalendar')?.addEventListener('click', closeWeeklyPlanPage);
  $('wpPagePrevWeek')?.addEventListener('click', () => shiftWeeklyPlanWeek(-1));
  $('wpPageNextWeek')?.addEventListener('click', () => shiftWeeklyPlanWeek(1));
  $('wpPageThisWeek')?.addEventListener('click', setWeeklyPlanToCurrentWeek);
  $('wpPageViewPersonalBtn')?.addEventListener('click', () => switchWeeklyPlanView('personal'));
  $('wpPageViewTeamBtn')?.addEventListener('click', () => switchWeeklyPlanView('team'));
  $('wpPageCopyReportBtn')?.addEventListener('click', copyWeeklyReportMarkdown);
  $('wpPageRefreshBtn')?.addEventListener('click', async () => {
    await Promise.allSettled([loadMemos({ force: true }), loadWeeklyPlanData({ force: true })]);
  });
  $('toolbarPublish').addEventListener('click', () => openFunctionsModal('taskPublish'));
  $('toolbarNewMemo')?.addEventListener('click', () => openMemoModal(null, new Date()));
  $('btnSelectAllAssignees')?.addEventListener('click', selectAllTaskAssignees);
  $('btnClearAssignees')?.addEventListener('click', clearTaskAssignees);
  $('toolbarDashboard')?.addEventListener('click', openDashboardPage);
  $('dashboardBackToCalendar')?.addEventListener('click', closeDashboardPage);
  $('dashboardRefresh')?.addEventListener('click', async () => { await loadMemos(); });
  $('toolbarExport').addEventListener('click', openExcelExportPanel);
  $('toolbarImport').addEventListener('click', importData);
  $('exportData').addEventListener('click', exportData);
  $('exportExcel')?.addEventListener('click', async () => {
    try {
      await exportExcelData();
    } catch (error) {
      alert(error.message);
    }
  });
  $('excelSelectAllUsers')?.addEventListener('click', selectAllExcelUsers);
  $('excelSelectCurrentUser')?.addEventListener('click', selectCurrentExcelUser);
  $('excelClearUserSelection')?.addEventListener('click', clearExcelUserSelection);
  $('excelUserPicker')?.addEventListener('change', (event) => {
    const option = event.target.closest?.('input[data-excel-user-id]');
    if (option) setExcelUserSelected(option.dataset.excelUserId, option.checked);
  });
  $('importData').addEventListener('click', importData);
  $('importFileInput')?.addEventListener('change', handleImportFile);
  $('clearData').addEventListener('click', clearAllData);
  $('viewStats').addEventListener('click', updateStats);
  $('publishTask').addEventListener('click', publishTask);
  $('reminderFilterTabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('.reminder-tab');
    if (tab) {
      event.stopPropagation();
      setReminderFilter(tab.dataset.filter);
    }
  });
  $('reminderSelectAll')?.addEventListener('change', (event) => {
    toggleSelectAllReminders(event.target.checked);
  });
  $('reminderBatchCompleteBtn')?.addEventListener('click', batchCompleteReminders);
  $('reminderUrgeBtn')?.addEventListener('click', batchUrgeReminders);
  $('searchInput').addEventListener('input', () => { $('clearSearch').style.display = $('searchInput').value.trim() ? 'block' : 'none'; renderMultiMonthCalendar(); renderMobileAgenda(); });
  $('clearSearch').addEventListener('click', () => { $('searchInput').value = ''; $('clearSearch').style.display = 'none'; renderMultiMonthCalendar(); renderMobileAgenda(); });
  const monthSelect = $('monthCountSelect');
  if (monthSelect) {
    monthSelect.value = String(state.monthsToShow);
    renderCustomMonthOptions();
    monthSelect.addEventListener('change', async (event) => {
      state.monthsToShow = Number(event.target.value);
      localStorage.setItem('calendarMonthCount', String(state.monthsToShow));
      renderCustomMonthOptions();
      await loadMemos();
    });
  }
  ['prevMonth', 'calendarPrevMonth'].forEach((id) => $(id)?.addEventListener('click', () => shiftVisibleMonth(-1)));
  ['nextMonth', 'calendarNextMonth'].forEach((id) => $(id)?.addEventListener('click', () => shiftVisibleMonth(1)));
  $('goTodayBtn')?.addEventListener('click', async () => {
    state.currentDate = new Date();
    await loadMemos();
    const todayEl = document.querySelector('.calendar-day.today');
    if (todayEl) {
      todayEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  $('themeToggleBtn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    toggleTheme();
    $('themeToggleBtn')?.blur();
  });

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setActiveTab(tab.dataset.tab)));

  document.addEventListener('click', async (event) => {
    const themeToggle = event.target.closest('#loginThemeToggle');
    if (themeToggle) {
      event.stopPropagation();
      toggleTheme();
      return;
    }
    const color = event.target.closest('.color-option');
    if (color) {
      if (color.dataset.target === 'task') state.selectedTaskColor = color.dataset.color;
      else state.selectedMemoColor = color.dataset.color;
      renderColorOptions(color.dataset.color, color.dataset.target);
      return;
    }
    const assigneeMode = event.target.closest('.task-assignee-mode');
    if (assigneeMode) { event.stopPropagation(); setTaskAssigneeMode(assigneeMode.dataset.mode); return; }
    const assigneeTag = event.target.closest('.assignee-tag');
    if (assigneeTag) { event.stopPropagation(); toggleTaskAssignee(assigneeTag.dataset.userId); return; }
    const dashboardUserTarget = event.target.closest('.dashboard-user-row[data-dashboard-user-id]');
    if (dashboardUserTarget) { event.stopPropagation(); jumpToUserCalendar(dashboardUserTarget.dataset.dashboardUserId); return; }
    const dashboardRiskTarget = event.target.closest('.dashboard-risk-item[data-memo-id]');
    if (dashboardRiskTarget) { event.stopPropagation(); await openDashboardMemo(dashboardRiskTarget.dataset.memoId); return; }
    const statusFilter = event.target.closest('[data-status-filter]');
    if (statusFilter) {
      event.stopPropagation();
      const targetFilter = statusFilter.dataset.statusFilter;
      const nextFilter = (state.calendarStatusFilter === targetFilter && targetFilter !== 'all') ? 'all' : targetFilter;
      setCalendarStatusFilter(nextFilter);
      return;
    }
    const leaderboardTarget = event.target.closest('.leaderboard-card[data-user-id], .leaderboard-champion[data-user-id]');
    if (leaderboardTarget) { event.stopPropagation(); jumpToUserCalendar(leaderboardTarget.dataset.userId); return; }
    const agendaItem = event.target.closest('.mobile-agenda-item[data-memo-id]');
    if (agendaItem) { event.stopPropagation(); await openMemoModal(agendaItem.dataset.memoId); return; }
    if (event.target.closest('#mobileAgendaAdd')) { event.stopPropagation(); await openMemoModal(null, state.selectedAgendaDate); return; }
    const memoItem = event.target.closest('.day-memo-item');
    if (memoItem) { event.stopPropagation(); await openMemoModal(memoItem.dataset.memoId); return; }
    const completeBtn = event.target.closest('.task-btn-complete');
    if (completeBtn) { event.stopPropagation(); await toggleMemoCompletion(completeBtn.dataset.id); return; }
    const editBtn = event.target.closest('.task-btn-edit');
    if (editBtn) {
      event.stopPropagation();
      closeFunctionsModal();
      closeDailyDetailModal();
      closeReminderModal();
      await openMemoModal(editBtn.dataset.id);
      return;
    }
    const userSaveBtn = event.target.closest('.user-save-btn');
    if (userSaveBtn) { event.stopPropagation(); await saveUserById(userSaveBtn.dataset.userId); return; }
    const userDeleteBtn = event.target.closest('.user-delete-btn');
    if (userDeleteBtn) { event.stopPropagation(); await deleteUserById(userDeleteBtn.dataset.userId); return; }
    const deleteBtn = event.target.closest('.task-btn-delete');
    if (deleteBtn) { event.stopPropagation(); await deleteMemoById(deleteBtn.dataset.id); return; }
    const reminderCb = event.target.closest('.reminder-item-checkbox');
    if (reminderCb) {
      event.stopPropagation();
      toggleReminderSelection(reminderCb.dataset.memoId);
      return;
    }
    const reminderRow = event.target.closest('.reminder-item-row');
    if (reminderRow) {
      event.stopPropagation();
      closeReminderModal();
      await openMemoModal(reminderRow.dataset.memoId);
      return;
    }
    const quickAddBtn = event.target.closest('.day-add');
    if (quickAddBtn) {
      event.stopPropagation();
      await openMemoModal(null, quickAddBtn.dataset.date);
      return;
    }
    const emptyState = event.target.closest('#dailyDetailList .empty-state');
    if (emptyState) {
      event.stopPropagation();
      openDetailedMemoFromDaily();
      return;
    }
    const countBadge = event.target.closest('.memo-count');
    if (countBadge) {
      event.stopPropagation();
      const parentDay = countBadge.closest('.calendar-day[data-date]');
      if (parentDay) {
        openDailyDetailModal(parentDay.dataset.date);
        return;
      }
    }
    const day = event.target.closest('.calendar-day[data-date]');
    if (day) {
      const targetDate = day.dataset.date;
      if (window.matchMedia?.('(max-width: 768px)').matches) {
        state.selectedAgendaDate = targetDate;
        renderMobileAgenda();
        const agenda = $('mobileAgenda');
        if (agenda) {
          agenda.scrollIntoView({ behavior: 'smooth', block: 'start' });
          agenda.classList.remove('agenda-pulse');
          void agenda.offsetWidth;
          agenda.classList.add('agenda-pulse');
        }
        return;
      }
      const key = typeof targetDate === 'string' ? targetDate : dateKey(targetDate);
      const dayMemos = getCalendarMemos().filter((memo) => memo.date === key);
      // 当天尚无备忘录时，直接自动展开“添加详细备忘录”弹窗
      if (dayMemos.length === 0) {
        await openMemoModal(null, targetDate);
        return;
      }
      openDailyDetailModal(targetDate);
      return;
    }
    const complete = event.target.closest('.complete-all-btn');
    if (complete && !complete.disabled && !complete.classList.contains('all-completed') && !complete.classList.contains('empty-disabled')) {
      await completeAllMemosForMonth(complete.dataset.month);
    }
  });
}

function patchStaticText() {
  const dataText = document.querySelector('#dataManagementTab p');
  if (dataText) dataText.textContent = '服务器版数据保存在 PostgreSQL 中，管理员可导出 Excel；JSON 导出仅用于备份当前可见记录。';
  ['saveReminderSettings', 'testReminder'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('click', () => alert('服务器版该设置后续接入，现在核心记录已由服务器保存。'));
  });
}

function addTablerIcon(element, name) {
  if (!element || element.querySelector(':scope > .tabler-icon')) return;
  const icon = document.createElement('span');
  icon.className = 'tabler-icon';
  icon.dataset.icon = name;
  icon.setAttribute('aria-hidden', 'true');
  element.prepend(icon);
  element.classList.add('tabler-decorated');
}

function decorateTablerUI() {
  // The local HTML generator can still produce the older topbar position.
  // Keep the calendar navigation in the calendar region in either layout.
  const calendarNavigation = $('calendarNavigation');
  const calendarContainer = document.querySelector('.calendar-container');
  if (calendarNavigation && calendarContainer && !calendarContainer.contains(calendarNavigation)) {
    let navWrap = calendarContainer.querySelector('.calendar-nav-wrap');
    if (!navWrap) {
      navWrap = document.createElement('div');
      navWrap.className = 'calendar-nav-wrap';
      calendarContainer.prepend(navWrap);
    }
    navWrap.append(calendarNavigation);
    calendarNavigation.classList.remove('topbar-nav');
    calendarNavigation.classList.add('calendar-main-nav');
  }
  $('appTopbar')?.classList.add('card');
  const toolbarButtons = document.querySelector('.toolbar-buttons');
  let more = $('toolbarMore');
  if (toolbarButtons && !more) {
    more = document.createElement('details');
    more.id = 'toolbarMore';
    more.className = 'toolbar-more';
    const summary = document.createElement('summary');
    summary.className = 'toolbar-btn toolbar-btn-primary btn btn-primary toolbar-more-trigger';
    summary.innerHTML = '<span class="tabler-icon" data-icon="database" aria-hidden="true"></span><span>数据操作</span><span class="toolbar-more-caret"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>';
    more.append(summary);
    const menu = document.createElement('div');
    menu.className = 'toolbar-more-menu';
    ['toolbarExport', 'toolbarImport'].forEach((id) => {
      const button = $(id);
      if (button) {
        button.classList.add('toolbar-more-item');
        menu.append(button);
      }
    });
    more.append(menu);
    toolbarButtons.append(more);

    // 动态同步父级容器层叠权重
    more.addEventListener('toggle', () => {
      more.closest('.workspace-subbar')?.classList.toggle('has-open-menu', more.open);
    });

    // 点击外部自动收起下拉
    document.addEventListener('click', (e) => {
      const el = $('toolbarMore');
      if (el && el.open && !el.contains(e.target)) {
        el.open = false;
        el.closest('.workspace-subbar')?.classList.remove('has-open-menu');
      }
    });

    // 点击菜单内按钮后自动收起下拉
    menu.addEventListener('click', (e) => {
      if (e.target.closest('button, .toolbar-btn')) {
        const el = $('toolbarMore');
        if (el) {
          el.open = false;
          el.closest('.workspace-subbar')?.classList.remove('has-open-menu');
        }
      }
    });
  } else if (more) {
    const summary = more.querySelector('summary');
    if (summary && !summary.classList.contains('toolbar-more-trigger')) {
      summary.className = 'toolbar-btn toolbar-btn-primary btn btn-primary toolbar-more-trigger';
      summary.innerHTML = '<span class="tabler-icon" data-icon="database" aria-hidden="true"></span><span>数据操作</span><span class="toolbar-more-caret"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>';
    }
  }
  ['toolbarPublish', 'toolbarDashboard', 'toolbarExport'].forEach((id) => {
    const el = $(id);
    if (!el || el.closest('.app-sidebar')) return;
    el.classList.remove('toolbar-btn-primary', 'toolbar-btn-success', 'btn-primary', 'btn-success');
    el.classList.add('toolbar-btn-secondary');
  });
  const grid = $('multiMonthCalendar');
  if (grid && !$('mobileAgenda')) {
    const agenda = document.createElement('section');
    agenda.id = 'mobileAgenda';
    agenda.className = 'mobile-agenda card';
    agenda.setAttribute('aria-label', '所选日期的事项');
    grid.insertAdjacentElement('afterend', agenda);
  }
  $('topbarUserBadge')?.classList.add('badge');
  $('serverMemberSelect')?.classList.add('form-select');
  $('monthCountSelect')?.classList.add('form-select');
  $('searchInput')?.classList.add('form-control');
  $('searchInput')?.setAttribute('aria-label', '搜索备忘录');
  $('quickMemoTitle')?.setAttribute('aria-label', '快速添加备忘录标题');
  ['searchInput', 'memoTitle', 'taskTitle', 'quickMemoTitle'].forEach((id) => $(id)?.setAttribute('autocomplete', 'off'));
  $('memoForm')?.setAttribute('autocomplete', 'off');
  const searchContainer = document.querySelector('.search-container');
  if (searchContainer) {
    searchContainer.classList.add('tabler-search');
    if (!searchContainer.querySelector(':scope > .tabler-icon')) {
      const searchIcon = document.createElement('span');
      searchIcon.className = 'tabler-icon';
      searchIcon.dataset.icon = 'search';
      searchIcon.setAttribute('aria-hidden', 'true');
      searchContainer.prepend(searchIcon);
    }
  }

  const buttons = [
    ['prevMonth', 'chevron-left', 'btn', 'btn-icon'],
    ['nextMonth', 'chevron-right', 'btn', 'btn-icon'],
    ['goTodayBtn', 'calendar', 'btn', 'btn-primary'],
    ['themeToggleBtn', null, 'btn', 'btn-icon'],
    ['serverLogout', 'logout', 'btn'],
    ['toolbarPublish', 'send', 'btn', 'btn-outline-secondary'],
    ['toolbarDashboard', 'chart-bar', 'btn', 'btn-outline-secondary'],
    ['toolbarExport', 'file-spreadsheet', 'btn', 'btn-outline-secondary'],
    ['toolbarImport', 'upload', 'btn', 'btn-outline-secondary'],
    ['calendarPrevMonth', 'chevron-left', 'btn', 'btn-icon'],
    ['calendarNextMonth', 'chevron-right', 'btn', 'btn-icon'],
    ['floatingReminder', 'bell', 'btn', 'btn-icon'],
    ['floatingFunctions', 'settings', 'btn', 'btn-icon'],
    ['quickAddMemo', 'plus', 'btn', 'btn-primary'],
    ['addNewMemoBtn', 'plus', 'btn', 'btn-primary']
  ];
  buttons.forEach(([id, icon, ...classes]) => {
    const button = $(id);
    if (!button) return;
    if (button.closest('.app-sidebar')) {
      // 保持侧边栏专属导航按钮原有设计与图标，不注入通用卡片按钮样式
      return;
    }
    button.classList.add(...classes);
    if (icon) addTablerIcon(button, icon);
  });

  document.querySelectorAll('#dashboardPage .dashboard-card').forEach((card) => card.classList.add('card'));
  document.querySelectorAll('#dashboardPage .dashboard-card-title').forEach((header) => header.classList.add('card-header'));
  ['memoModal', 'functionsModal', 'dailyDetailModal', 'reminderModal'].forEach((id) => {
    const modal = $(id);
    const title = modal?.querySelector(':is(.modal-title, .reminder-title)');
    if (modal && title) {
      title.id = `${id}Title`;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', title.id);
    }
    modal?.querySelector(':is(.modal-content, .reminder-content)')?.classList.add('card');
    modal?.querySelector(':is(.modal-header, .reminder-header)')?.classList.add('card-header');
    modal?.querySelector(':is(.modal-body, .reminder-body)')?.classList.add('card-body');
    modal?.querySelector(':is(.modal-footer, .reminder-actions)')?.classList.add('card-footer');
    modal?.querySelectorAll('.form-group > label').forEach((label) => label.classList.add('form-label'));
  });
  [['closeMemoModal', '关闭备忘录编辑'], ['closeFunctionsModal', '关闭功能面板'],
    ['closeDailyDetailModal', '关闭每日详情'], ['closeReminderModal', '关闭提醒中心']]
    .forEach(([id, label]) => {
      $(id)?.setAttribute('aria-label', label);
      $(id)?.setAttribute('type', 'button');
    });
  const memoFooter = document.querySelector('#memoModal .modal-footer');
  if (memoFooter && !$('memoSaveFeedback')) {
    const feedback = document.createElement('div');
    feedback.id = 'memoSaveFeedback';
    feedback.className = 'operation-feedback';
    feedback.setAttribute('role', 'alert');
    feedback.hidden = true;
    memoFooter.prepend(feedback);
  }
  const publishButton = $('publishTask');
  if (publishButton && !$('taskPublishFeedback')) {
    const feedback = document.createElement('div');
    feedback.id = 'taskPublishFeedback';
    feedback.className = 'operation-feedback';
    feedback.setAttribute('role', 'alert');
    feedback.hidden = true;
    publishButton.before(feedback);
  }
  document.querySelector('#reminderModal .reminder-section-title span')?.replaceChildren('未完成事项');
  if ($('markAllAsRead')) $('markAllAsRead').innerHTML = '<i class="fas fa-check"></i> 关闭提醒中心';
  if ($('autoCloseReminder')) $('autoCloseReminder').checked = localStorage.getItem('calendarReminderAutoClose') === '1';
  document.querySelectorAll('select').forEach((s) => s.classList.add('form-select'));
  $('quickMemoTitle')?.classList.add('form-control');
  document.querySelector('#dailyDetailModal .daily-quick-add-box')?.classList.add('card');
  $('markdownPreview')?.classList.add('card');
  document.querySelectorAll('#functionsModal :is(.task-publish-info, .export-info, .data-stats-card, .excel-export-panel)')
    .forEach((card) => card.classList.add('card'));

  const modal = $('functionsModal');
  if (!modal) return;
  modal.querySelector('.tabs')?.classList.add('nav', 'nav-pills');
  modal.querySelector('#taskAssigneeSummary')?.classList.add('badge', 'bg-blue-lt');
  modal.querySelectorAll('.tabs .tab[data-tab]').forEach((tab) => {
    tab.classList.add('nav-link');
    if (tab.querySelector('.tabler-icon')) return;
    const icon = document.createElement('span');
    icon.className = 'tabler-icon';
    icon.setAttribute('aria-hidden', 'true');
    tab.prepend(icon);
  });
}

function initSystemThemeListener() {
  if (!window.matchMedia) return;
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSysChange = () => {
    if (state.themePreference === 'system') {
      applyTheme('system');
    }
  };
  if (mql.addEventListener) {
    mql.addEventListener('change', handleSysChange);
  } else if (mql.addListener) {
    mql.addListener(handleSysChange);
  }
}

function initSidebarLayout() {
  const sidebar = $('appSidebar');
  const toggleBtn = $('sidebarToggle');
  const backdrop = $('sidebarBackdrop');
  if (!sidebar) return;

  const closeMobileSidebar = () => {
    sidebar.classList.remove('mobile-open');
    backdrop?.classList.remove('active');
  };

  // 恢复之前持久化的桌面端折叠状态
  if (window.innerWidth > 768) {
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
    }
  }

  // 顶部折叠/展开按钮交互
  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.innerWidth <= 768) {
      const isOpen = sidebar.classList.toggle('mobile-open');
      backdrop?.classList.toggle('active', isOpen);
    } else {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
    }
  });

  // 移动端点击背景遮罩、关闭按钮或外部区域自动收起
  backdrop?.addEventListener('click', closeMobileSidebar);
  $('sidebarCloseBtn')?.addEventListener('click', closeMobileSidebar);
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('mobile-open')) {
      if (!sidebar.contains(e.target) && !toggleBtn?.contains(e.target)) {
        closeMobileSidebar();
      }
    }
  });

  // 侧边栏专属导航交互绑定
  $('navCalendar')?.addEventListener('click', () => {
    if (state.activeView === 'weeklyPlan') {
      closeWeeklyPlanPage();
    } else if (state.activeView === 'dashboard') {
      closeDashboardPage();
    } else {
      state.activeView = 'calendar';
      applyMainView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (window.innerWidth <= 768) closeMobileSidebar();
  });

  $('navWeeklyPlan')?.addEventListener('click', () => {
    openWeeklyPlanPage();
    if (window.innerWidth <= 768) closeMobileSidebar();
  });

  $('sidebarLogoLink')?.addEventListener('click', () => {
    if (state.activeView === 'weeklyPlan') {
      closeWeeklyPlanPage();
    } else if (state.activeView === 'dashboard') {
      closeDashboardPage();
    } else {
      state.activeView = 'calendar';
      applyMainView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (window.innerWidth <= 768) closeMobileSidebar();
  });

  $('navDataManagement')?.addEventListener('click', () => {
    openFunctionsModal('dataManagement');
    if (window.innerWidth <= 768) closeMobileSidebar();
  });

  $('navSettings')?.addEventListener('click', () => {
    openFunctionsModal('reminderSettings');
    if (window.innerWidth <= 768) closeMobileSidebar();
  });

  $('toolbarStaffExport')?.addEventListener('click', () => {
    exportStaffCalendarExcel();
    if (window.innerWidth <= 768) closeMobileSidebar();
  });

  // 移动端点击侧边栏任意功能或操作项自动收起抽屉（深浅色主题切换保留便于对比）
  sidebar.querySelectorAll('.sidebar-nav .nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.id !== 'themeToggleBtn' && window.innerWidth <= 768) {
        closeMobileSidebar();
      }
    });
  });
}

injectServerCss();
decorateTablerUI();
initSystemThemeListener();
initSidebarLayout();
initEventListeners();
initCustomDropdowns();
initMemoDatePicker();
initMemoDuePicker();
initMemoHoverTooltip();
patchStaticText();
// 手机端刷新时由工作台初始化决定起点，避免浏览器恢复到上次浏览的中段。
if (window.innerWidth <= 768 && 'scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
restoreSession();
