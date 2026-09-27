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
  memoEtag: '',
  memoRangeKey: '',
  sessionVersion: 0,
  memoRequestVersion: 0,
  memoDetailRequestVersion: 0,
  initialLoadSessionVersion: null,
  memoRequestController: null,
  currentDate: new Date(),
  monthsToShow: Number(localStorage.getItem('calendarMonthCount') || 2),
  selectedUserId: 'all',
  calendarStatusFilter: 'all',
  selectedMemoId: null,
  dailyDetailDate: new Date(),
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
  detailDraftFromQuickAdd: false
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
  if (!response.ok) throw new Error(data.message || '请求失败');
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
          <div class="server-brand-glow"></div>
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
}

function hideLoginOverlay() {
  const overlay = $('serverLoginOverlay');
  if (overlay) overlay.style.display = 'none';
}

function ensureSessionOverlay() {
  let overlay = $('serverSessionOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'serverSessionOverlay';
  overlay.innerHTML = `
    <div class="server-session-card" role="status" aria-live="polite">
      <div class="server-session-spinner" id="serverSessionSpinner" aria-hidden="true"></div>
      <h2 id="serverSessionTitle">正在加载日历</h2>
      <p id="serverSessionMessage">正在读取日历数据，请稍候…</p>
      <div class="server-session-actions">
        <button id="serverSessionRetry" type="button" hidden>重新加载日历</button>
        <button id="serverSessionLogout" type="button" hidden>退出登录</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  $('serverSessionRetry').addEventListener('click', retryAppStart);
  $('serverSessionLogout').addEventListener('click', logout);
  return overlay;
}

function showSessionOverlay(message = '正在读取日历数据，请稍候…', { error = false } = {}) {
  const overlay = ensureSessionOverlay();
  const title = $('serverSessionTitle');
  const spinner = $('serverSessionSpinner');
  if (title) title.textContent = error ? '日历加载失败' : '正在加载日历';
  if ($('serverSessionMessage')) $('serverSessionMessage').textContent = message;
  if (spinner) spinner.hidden = error;
  if ($('serverSessionRetry')) $('serverSessionRetry').hidden = !error;
  if ($('serverSessionLogout')) $('serverSessionLogout').hidden = !error;
  overlay.style.display = 'flex';
}

function hideSessionOverlay() {
  const overlay = $('serverSessionOverlay');
  if (overlay) overlay.style.display = 'none';
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
      background: radial-gradient(circle at 15% 20%, rgba(67, 97, 238, 0.22) 0%, transparent 45%),
                  radial-gradient(circle at 85% 80%, rgba(123, 31, 162, 0.22) 0%, transparent 45%),
                  #090d16;
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
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      padding: 20px;
    }
    .server-session-card {
      width: min(360px, 100%);
      padding: 32px 28px;
      border-radius: 18px;
      background: white;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
      text-align: center;
    }
    .server-session-card h2 {
      margin: 18px 0 8px;
      color: var(--dark-color);
      font-size: 1.25rem;
    }
    .server-session-card p {
      margin: 0;
      color: #6c757d;
      line-height: 1.6;
    }
    .server-session-spinner {
      width: 40px;
      height: 40px;
      margin: 0 auto;
      border: 4px solid rgba(67, 97, 238, 0.18);
      border-top-color: var(--primary-color);
      border-radius: 50%;
      animation: server-session-spin 0.8s linear infinite;
    }
    .server-session-spinner[hidden] {
      display: none;
    }
    .server-session-actions {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 22px;
    }
    .server-session-actions button {
      padding: 10px 14px;
      border: 0;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
      color: white;
      font-weight: 700;
      cursor: pointer;
    }
    .server-session-actions button:last-child {
      background: #6c757d;
    }
    .server-session-actions button[hidden] {
      display: none;
    }
    @keyframes server-session-spin {
      to { transform: rotate(360deg); }
    }

    /* 新企业级双栏登录容器 */
    .server-login-container {
      width: min(980px, 100%);
      background: #ffffff;
      border-radius: 24px;
      box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08);
      display: grid;
      grid-template-columns: 4.4fr 5.6fr;
      overflow: hidden;
      box-sizing: border-box;
      text-align: left;
    }

    /* 左侧品牌区 */
    .server-login-brand {
      background: linear-gradient(150deg, #1e1b4b 0%, #2e1065 48%, #0f172a 100%);
      color: #ffffff;
      padding: 40px 36px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
      box-sizing: border-box;
    }

    .server-brand-glow {
      position: absolute;
      right: -50px;
      bottom: -50px;
      width: 200px;
      height: 200px;
      background: rgba(99, 102, 241, 0.25);
      border-radius: 50%;
      filter: blur(50px);
      pointer-events: none;
    }

    .server-brand-logo-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .server-brand-logo-icon {
      width: 44px;
      height: 44px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      backdrop-filter: blur(8px);
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
      backdrop-filter: blur(12px);
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
      background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
      color: #ffffff;
      font-weight: 700;
      font-size: 0.85rem;
      letter-spacing: 0.3px;
      cursor: pointer;
      transition: all 0.18s ease;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.3);
    }

    #serverLoginButton:hover, #serverRegisterButton:hover, #serverChangePasswordButton:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(79, 70, 229, 0.4);
    }

    #serverLoginButton:active, #serverRegisterButton:active, #serverChangePasswordButton:active {
      transform: translateY(0);
    }

    .btn-register-action {
      background: linear-gradient(135deg, #059669 0%, #047857 100%) !important;
      box-shadow: 0 4px 14px rgba(5, 150, 105, 0.3) !important;
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
      transform: rotate(20deg);
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
      transition: all 0.2s ease;
      backdrop-filter: blur(12px);
    }
    html[data-theme="dark"] .login-theme-toggle {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #e2e8f0;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
    }
    html[data-theme="dark"] .login-theme-toggle:hover {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.3);
      color: #ffffff;
      transform: translateY(-1px);
    }
    html[data-theme="light"] .login-theme-toggle {
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid #cbd5e1;
      color: #334155;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.06);
    }
    html[data-theme="light"] .login-theme-toggle:hover {
      background: #ffffff;
      border-color: #94a3b8;
      color: #0f172a;
      transform: translateY(-1px);
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
      margin-bottom: 16px;
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

    /* ---------------- 浅色模式 (Light Mode) ---------------- */
    html[data-theme="light"] body {
      background: #f1f5f9 !important;
      color: #0f172a !important;
    }
    html[data-theme="light"] header.app-topbar {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
      color: white !important;
      box-shadow: 0 4px 20px rgba(37, 99, 235, 0.18) !important;
    }
    html[data-theme="light"] .toolbar.workspace-subbar {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
    }
    html[data-theme="light"] .month-calendar {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04) !important;
    }
    html[data-theme="light"] .calendar-day {
      background-color: #f8fafc !important;
      border-color: rgba(0, 0, 0, 0.1) !important;
    }
    html[data-theme="light"] .calendar-day:hover {
      background-color: #edf2f7 !important;
    }
    html[data-theme="light"] .calendar-day.other-month {
      background-color: #f1f5f9 !important;
      opacity: 0.45 !important;
    }
    html[data-theme="light"] .calendar-day.today {
      background-color: rgba(37, 99, 235, 0.08) !important;
      border-color: #2563eb !important;
    }
    html[data-theme="light"] .team-leaderboard,
    html[data-theme="light"] .dashboard-hero,
    html[data-theme="light"] .dashboard-card {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
    }

    /* 浅色模式登录界面 */
    html[data-theme="light"] #serverLoginOverlay {
      background: radial-gradient(circle at 10% 20%, rgba(37, 99, 235, 0.08) 0%, transparent 45%),
                  radial-gradient(circle at 90% 80%, rgba(99, 102, 241, 0.08) 0%, transparent 45%),
                  #f1f5f9 !important;
    }
    html[data-theme="light"] .server-login-container {
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.03) !important;
    }
    html[data-theme="light"] .server-login-brand {
      background: linear-gradient(145deg, #2563eb 0%, #1e40af 100%) !important;
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

    /* ---------------- 深色模式 (Dark Mode) ---------------- */
    html[data-theme="dark"] body {
      background: #090d16 !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] header.app-topbar {
      background: linear-gradient(135deg, #111827 0%, #0f172a 100%) !important;
      border: 1px solid #1f293d !important;
      color: #f8fafc !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
    }
    html[data-theme="dark"] .topbar-user-badge {
      background: rgba(255, 255, 255, 0.08) !important;
      border-color: #334155 !important;
      color: #e2e8f0 !important;
    }
    html[data-theme="dark"] .topbar-nav {
      background: #1e293b !important;
      border-color: #334155 !important;
    }
    html[data-theme="dark"] .topbar-nav .today-btn {
      background: #3b82f6 !important;
      color: white !important;
    }
    html[data-theme="dark"] .topbar-member-selector select {
      background: #1e293b !important;
      color: #f1f5f9 !important;
      border-color: #334155 !important;
    }
    html[data-theme="dark"] .toolbar.workspace-subbar {
      background: #111827 !important;
      border: 1px solid #1f293d !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3) !important;
    }
    html[data-theme="dark"] .search-input {
      background: #0b0f19 !important;
      border: 1.5px solid #26324a !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .search-input:focus {
      border-color: #3b82f6 !important;
    }
    html[data-theme="dark"] .month-count-selector {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .month-count-selector select {
      background: #0b0f19 !important;
      border: 1.5px solid #26324a !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .month-calendar {
      background: #111827 !important;
      border: 1px solid #1f293d !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35) !important;
    }
    html[data-theme="dark"] .month-header {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .month-title {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .stat-item {
      background: #1e293b !important;
      border: 1px solid #334155 !important;
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .stat-item.active {
      border-color: #3b82f6 !important;
      color: #ffffff !important;
    }
    html[data-theme="dark"] .weekdays div {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .calendar-day {
      background-color: #0d131f !important;
      border: 1px dashed #26324a !important;
    }
    html[data-theme="dark"] .calendar-day:hover {
      background-color: #1e293b !important;
      border-color: #3b82f6 !important;
    }
    html[data-theme="dark"] .calendar-day .day-number {
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .calendar-day.other-month {
      background-color: #080c14 !important;
      opacity: 0.35 !important;
      border-color: #1a2233 !important;
    }
    html[data-theme="dark"] .calendar-day.today {
      background-color: rgba(59, 130, 246, 0.14) !important;
      border: 2px solid #3b82f6 !important;
    }
    html[data-theme="dark"] .day-memo-item {
      background-color: #1a2333 !important;
      color: #cbd5e1 !important;
    }
    html[data-theme="dark"] .team-leaderboard,
    html[data-theme="dark"] .dashboard-hero,
    html[data-theme="dark"] .dashboard-card {
      background: #111827 !important;
      border: 1px solid #1f293d !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .leaderboard-card,
    html[data-theme="dark"] .leaderboard-row,
    html[data-theme="dark"] .dashboard-metric {
      background: #0d131f !important;
      border: 1px solid #1f293d !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .modal-content {
      background-color: #111827 !important;
      border: 1px solid #1f293d !important;
      color: #f1f5f9 !important;
      box-shadow: 0 25px 70px rgba(0, 0, 0, 0.7) !important;
    }
    html[data-theme="dark"] .modal-header {
      background: #1e293b !important;
      border-bottom: 1px solid #334155 !important;
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .modal-footer {
      background-color: #0d131f !important;
      border-top: 1px solid #1f293d !important;
    }
    html[data-theme="dark"] .form-control,
    html[data-theme="dark"] .memo-input,
    html[data-theme="dark"] textarea {
      background-color: #0b0f19 !important;
      border-color: #334155 !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .tabs {
      border-bottom-color: #1f293d !important;
    }
    html[data-theme="dark"] .tab {
      color: #94a3b8 !important;
    }
    html[data-theme="dark"] .tab.active {
      color: #3b82f6 !important;
      border-bottom-color: #3b82f6 !important;
    }
    html[data-theme="dark"] .task-item {
      background-color: #0d131f !important;
      border-color: #1f293d !important;
      color: #f1f5f9 !important;
    }
    html[data-theme="dark"] .task-title {
      color: #f8fafc !important;
    }
    html[data-theme="dark"] .task-content {
      color: #94a3b8 !important;
    }

    /* 深色模式登录界面 */
    html[data-theme="dark"] #serverLoginOverlay {
      background: radial-gradient(circle at 15% 20%, rgba(59, 130, 246, 0.18) 0%, transparent 45%),
                  radial-gradient(circle at 85% 80%, rgba(99, 102, 241, 0.18) 0%, transparent 45%),
                  #090d16 !important;
    }
    html[data-theme="dark"] .server-login-container {
      background: #0f172a !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      box-shadow: 0 25px 70px -10px rgba(0, 0, 0, 0.8) !important;
    }
    html[data-theme="dark"] .server-login-brand {
      background: linear-gradient(145deg, #101935 0%, #0d1322 100%) !important;
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
        background: var(--primary-color);
        color: white !important;
        border-radius: 999px;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        box-shadow: 0 2px 5px rgba(67, 97, 238, 0.4);
      }
      .calendar-day .day-number {
        font-size: 0.8rem;
        margin-bottom: 2px;
        align-self: center;
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
        width: 7px;
        height: 7px;
        border-radius: 999px;
        margin: 0;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        flex-shrink: 0;
      }
      .calendar-day .memo-count {
        display: none !important;
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
  ['toolbarPublish', 'toolbarDashboard', 'toolbarImport', 'floatingFunctions', 'viewRecentTasks'].forEach((id) => setElementVisible(id, visible));
  setElementVisible('memberSelectWrap', visible);
  document.querySelectorAll('.admin-only-tab').forEach((tab) => {
    tab.hidden = state.user?.role !== 'admin';
    tab.style.display = state.user?.role === 'admin' ? '' : 'none';
  });
  setElementVisible('toolbarExport', state.user?.role === 'admin');
  if (!visible) state.activeView = 'calendar';
  applyMainView();
  const toolbarButtons = document.querySelector('.toolbar-buttons');
  if (toolbarButtons) toolbarButtons.style.display = visible ? '' : 'none';
  if (!visible && $('functionsModal')?.classList.contains('active')) closeFunctionsModal();
}

function applyMainView() {
  const dashboardVisible = canManageWorkspace() && state.activeView === 'dashboard';
  setElementVisible('dashboardPage', dashboardVisible);
  const calendarContainer = document.querySelector('.calendar-container');
  if (calendarContainer) calendarContainer.style.display = dashboardVisible ? 'none' : '';
  setElementVisible('teamLeaderboard', canManageWorkspace() && !dashboardVisible);
  $('toolbarDashboard')?.classList.toggle('active', dashboardVisible);
  if (dashboardVisible) renderDashboard();
}

function openDashboardPage() {
  if (!canManageWorkspace()) return;
  state.activeView = 'dashboard';
  closeFunctionsModal();
  applyMainView();
  window.requestAnimationFrame(() => $('dashboardPage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function closeDashboardPage() {
  state.activeView = 'calendar';
  renderTeamLeaderboard();
  applyMainView();
  window.requestAnimationFrame(() => $('multiMonthCalendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
  document.documentElement.setAttribute('data-theme-preference', pref);

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
    topbarBtn.innerHTML = `<i class="${iconClass}"></i>`;
    topbarBtn.title = titleText;
  }
  const loginBtn = $('loginThemeToggle');
  if (loginBtn) {
    loginBtn.innerHTML = `<i class="${iconClass}"></i> <span class="login-theme-label">${labelText}</span>`;
    loginBtn.title = titleText;
  }

  if (isDark) {
    document.documentElement.style.setProperty('--primary-color', '#3b82f6');
    document.documentElement.style.setProperty('--secondary-color', '#1d4ed8');
    document.documentElement.style.setProperty('--accent-color', '#60a5fa');
    document.documentElement.style.setProperty('--dark-color', '#f1f5f9');
    document.documentElement.style.setProperty('--light-color', '#0f172a');
  } else {
    document.documentElement.style.setProperty('--primary-color', '#2563eb');
    document.documentElement.style.setProperty('--secondary-color', '#1d4ed8');
    document.documentElement.style.setProperty('--accent-color', '#3b82f6');
    document.documentElement.style.setProperty('--dark-color', '#0f172a');
    document.documentElement.style.setProperty('--light-color', '#ffffff');
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
  state.memoDetailRequestVersion += 1;
  state.memoRequestController?.abort();
  state.memoRequestController = null;
  state.selectedMemoId = null;
  state.memos = [];
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
  showSessionOverlay('正在重新加载日历…');
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
    showSessionOverlay('正在加载日历…');
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
    showSessionOverlay('正在加载日历…');
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
  showSessionOverlay('正在恢复登录状态…');
  try {
    const data = await request('/auth/me');
    sessionVersion = beginSession(data.user);
    showSessionOverlay('正在加载日历…');
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

function resetSessionViewState() {
  state.currentDate = new Date();
  state.selectedUserId = canManageWorkspace() ? 'all' : String(state.user?.id || '');
  state.calendarStatusFilter = 'all';
  state.activeView = 'calendar';
  state.opsStatus = null;
  const searchInput = $('searchInput');
  if (searchInput) searchInput.value = '';
  if ($('clearSearch')) $('clearSearch').style.display = 'none';
}

async function startApp(sessionVersion = state.sessionVersion) {
  if (!isCurrentSession(sessionVersion)) return false;
  injectUserBar();
  resetSessionViewState();
  $('serverUserName').textContent = state.user.displayName;
  $('serverUserRole').textContent = `· ${displayUserRole(state.user)} · ${state.user.departmentName}`;
  applyRoleScopedUi();
  await loadUsers(sessionVersion);
  if (!isCurrentSession(sessionVersion)) return false;
  const initialSnapshotLoaded = await loadMemos({ force: true, sessionVersion });
  if (!isCurrentSession(sessionVersion)) return false;
  if (!initialSnapshotLoaded || state.memoRangeKey !== currentMemoRangeKey()) {
    throw new Error('首次日历数据未完成加载');
  }
  state.initialLoadSessionVersion = sessionVersion;
  startRealtimeRefresh();
  hideLoginOverlay();
  hideSessionOverlay();
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
}

function taskAssigneeCandidates() {
  return state.users.filter((user) => Number(user.id) !== Number(state.user?.id));
}

function normalizeTaskAssignees(candidates = taskAssigneeCandidates()) {
  const validIds = candidates.map((user) => Number(user.id));
  const validSet = new Set(validIds);
  state.taskAssigneeIds = state.taskAssigneeIds.map(Number).filter((id) => validSet.has(id));

  if (!state.taskAssigneeIds.length && validIds.length) {
    state.taskAssigneeIds = state.taskAssigneeMode === 'single' ? [validIds[0]] : [...validIds];
  }

  if (state.taskAssigneeMode === 'single' && state.taskAssigneeIds.length > 1) {
    state.taskAssigneeIds = [state.taskAssigneeIds[0]];
  }
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

function refreshMemoViews() {
  renderMultiMonthCalendar();
  renderTeamLeaderboard();
  applyMainView();
  updateStats();
  updateReminderBadge();
  if ($('reminderModal')?.classList.contains('active')) showReminderModal();
  else updateRecentTasks();
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
  state.memoEtag = '';
  refreshMemoViews();
  return true;
}

function removeMemosLocally(memoIds) {
  const ids = new Set((Array.isArray(memoIds) ? memoIds : [memoIds]).map(String));
  if (!ids.size) return;
  state.memos = state.memos.filter((memo) => !ids.has(String(memo.id)));
  state.memoEtag = '';
  refreshMemoViews();
}

async function syncMemoMutationOrReload(payload) {
  if (!syncMemosLocally(payload?.memo || payload?.memos || [])) {
    await loadMemos({ force: true });
  }
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
  );
}

async function refreshMemosInBackground() {
  if (!canRealtimeRefresh() || state.realtimeRefreshBusy) return;
  state.realtimeRefreshBusy = true;
  try {
    await loadMemos();
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
    { label: '总任务', value: summary.total, sub: `${summary.activeUsers} 人有任务` },
    { label: '已完成', value: summary.completed, sub: `完成率 ${summary.rate}%`, tone: 'success' },
    { label: '未完成', value: summary.pending, sub: '仍需推进' },
    { label: '逾期任务', value: summary.overdue, sub: '优先处理', tone: summary.overdue ? 'danger' : 'success' },
    { label: '临近截止', value: summary.dueSoon, sub: '3 天内到期', tone: summary.dueSoon ? 'warning' : 'success' },
    { label: '今日进度', value: `${summary.todayCompleted}/${summary.todayTotal}`, sub: '今日任务完成' }
  ];
  metrics.innerHTML = cards.map((card) => `
    <div class="dashboard-metric ${card.tone || ''}">
      <div class="dashboard-metric-label">${escapeHtml(card.label)}</div>
      <div class="dashboard-metric-value">${escapeHtml(card.value)}</div>
      <div class="dashboard-metric-sub">${escapeHtml(card.sub)}</div>
    </div>
  `).join('');
}

function renderDashboardUserLoad(rows) {
  const box = $('dashboardUserLoad');
  if (!box) return;
  box.innerHTML = rows.length
    ? rows.map((row) => `
      <div class="dashboard-user-row" data-dashboard-user-id="${row.user.id}" title="点击查看${escapeHtml(row.user.displayName)}的日历" style="--dashboard-rate:${row.rate}%">
        <div>
          <div class="dashboard-user-name">${escapeHtml(row.user.displayName)}</div>
          <div class="dashboard-user-role">${escapeHtml(displayUserRole(row.user))} · ${escapeHtml(row.user.departmentName || '')}</div>
        </div>
        <div>
          <div class="dashboard-progress"><div class="dashboard-progress-fill"></div></div>
          <div class="dashboard-user-stats">
            <span>总 ${row.total}</span>
            <span>完成 ${row.completed}</span>
            <span>未完成 ${row.pending}</span>
            <span>逾期 ${row.overdue}</span>
            <span>临近 ${row.dueSoon}</span>
          </div>
        </div>
        <div class="dashboard-user-rate">${row.rate}%</div>
      </div>
    `).join('')
    : '<div class="dashboard-empty">当前月份范围内暂无人员任务数据</div>';
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
    ? risks.map(({ memo, level, label }) => `
      <div class="dashboard-risk-item ${level}" data-memo-id="${memo.id}">
        <div class="dashboard-risk-title">${escapeHtml(label)} · ${escapeHtml(memo.title || '无标题')}</div>
        <div class="dashboard-risk-meta">
          ${escapeHtml(memo.ownerName || '未知人员')} · ${escapeHtml(memo.dueTime ? new Date(memo.dueTime).toLocaleString('zh-CN') : memo.date)}
        </div>
      </div>
    `).join('')
    : '<div class="dashboard-empty">当前没有明显风险任务</div>';
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
  const rows = days.map((day) => {
    const key = dateKey(day);
    const total = memos.filter((memo) => memo.date === key).length;
    const completed = memos.filter((memo) => memo.date === key && memo.completed).length;
    return { key, label: `${day.getMonth() + 1}/${day.getDate()}`, total, completed };
  });
  const max = Math.max(1, ...rows.map((row) => row.completed));
  box.innerHTML = rows.some((row) => row.total > 0)
    ? rows.map((row) => `
      <div class="dashboard-trend-row">
        <span>${escapeHtml(row.label)}</span>
        <div class="dashboard-trend-bar" title="完成 ${row.completed} / 总 ${row.total}">
          <div class="dashboard-trend-fill" style="--trend-rate:${Math.round((row.completed / max) * 100)}%"></div>
        </div>
        <strong>${row.completed}</strong>
      </div>
    `).join('')
    : '<div class="dashboard-empty">当前范围内暂无可展示趋势</div>';
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
        <div class="day-number">${i}</div>
        <div class="day-memos" id="dayMemos-${key}">
          ${dayMemos.map((memo, memoIndex) => {
            const memoColor = memo.color || colors[memoIndex % colors.length] || colors[0];
            return `
            <div class="day-memo-item ${memo.completed ? 'completed' : ''}" data-memo-id="${memo.id}" title="${escapeHtml(memoFullTitle(memo))}" style="--memo-color:${escapeHtml(memoColor)}">
              <span class="memo-color-dot" style="background-color:${escapeHtml(memoColor)}"></span>
              ${escapeHtml(memoDisplayTitle(memo))}
            </div>
          `;
          }).join('')}
        </div>
        ${dayMemos.length ? `<div class="memo-count">${dayMemos.length}</div>` : ''}
      </div>
    `);
  }

  while (cells.length < 42) {
    const next = cells.length - (firstDay.getDay() + lastDay.getDate()) + 1;
    cells.push(`<div class="calendar-day other-month">${next}</div>`);
  }

  return `
    <div class="month-calendar ${state.monthsToShow > 4 ? 'small' : ''}" id="monthCalendar${index}" data-month="${monthDate.getMonth()}" data-year="${monthDate.getFullYear()}">
      <div class="month-header">
        <div class="month-title">${monthDate.getFullYear()}年 ${monthNames[monthDate.getMonth()]}</div>
        <div class="month-right-area">
          <div class="month-stats" id="monthStats${index}">
            <div class="stat-item total ${state.calendarStatusFilter === 'all' ? 'active' : ''}" data-status-filter="all" title="显示全部任务"><i class="fas fa-tasks"></i><span class="stat-count-total">${monthMemos.length}</span></div>
            <div class="stat-item completed ${state.calendarStatusFilter === 'completed' ? 'active' : ''}" data-status-filter="completed" title="只显示已完成任务"><i class="fas fa-check-circle"></i><span class="stat-count-completed">${completed}</span></div>
            <div class="stat-item pending ${state.calendarStatusFilter === 'pending' ? 'active' : ''}" data-status-filter="pending" title="只显示未完成任务"><i class="fas fa-clock"></i><span class="stat-count-pending">${monthMemos.length - completed}</span></div>
          </div>
          ${createProgressCircle(progressPercent, index)}
          <button class="complete-all-btn" data-month="${monthKey(monthDate)}"><i class="fas fa-check-double"></i> 一键完成</button>
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

async function openMemoModal(memoId = null, date = new Date(), draft = {}) {
  state.selectedMemoId = memoId;
  const requestVersion = ++state.memoDetailRequestVersion;
  const dateValue = date instanceof Date ? dateKey(date) : String(date);
  const draftTitle = String(draft.title || '').trim();
  let memo = memoId ? state.memos.find((item) => String(item.id) === String(memoId)) : null;

  if (memoId && !memo) return;
  if (memoId && !Object.prototype.hasOwnProperty.call(memo, 'content')) {
    try {
      const data = await request(`/memos/${memoId}`);
      if (requestVersion !== state.memoDetailRequestVersion || String(state.selectedMemoId) !== String(memoId)) return;
      memo = data.memo;
    } catch (error) {
      if (requestVersion === state.memoDetailRequestVersion) alert(`读取任务详情失败：${error.message}`);
      return;
    }
  }

  if (requestVersion !== state.memoDetailRequestVersion || String(state.selectedMemoId) !== String(memoId)) return;
  state.detailDraftFromQuickAdd = Boolean(!memo && draft.fromQuickAdd);
  $('memoTitle').value = memo?.title || draftTitle;
  $('memoDate').value = memo?.date || dateValue;
  $('memoDueTime').value = memo?.dueTime ? toLocalDateTimeInput(memo.dueTime) : '';
  $('memoContent').value = memo?.content || '';
  $('memoCompleted').checked = Boolean(memo?.completed);
  $('deleteMemo').style.display = memo ? 'inline-flex' : 'none';
  state.selectedMemoColor = memo?.color || randomMemoColor(latestMemoColor());
  renderColorOptions(state.selectedMemoColor, 'memo');
  updateMarkdownPreview();
  $('memoModal').classList.add('active');
}

function closeMemoModal() {
  state.memoDetailRequestVersion += 1;
  $('memoModal').classList.remove('active');
  state.selectedMemoId = null;
  state.detailDraftFromQuickAdd = false;
}

function toLocalDateTimeInput(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function updateMarkdownPreview() {
  const content = $('memoContent')?.value || '';
  const preview = $('markdownPreview');
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
  const title = $('memoTitle').value.trim();
  const dueTime = $('memoDueTime').value;
  if (!title) {
    alert('请输入标题');
    return;
  }
  if (!dueTime) {
    alert('请添加截止时间后再保存');
    $('memoDueTime').focus();
    return;
  }
  const payload = {
    ownerId: state.selectedUserId !== 'all' ? Number(state.selectedUserId) : state.user.id,
    date: $('memoDate').value,
    title,
    content: $('memoContent').value,
    color: state.selectedMemoColor,
    completed: $('memoCompleted').checked,
    dueTime
  };
  const isNewMemo = !state.selectedMemoId;
  const shouldClearQuickDraft = isNewMemo && state.detailDraftFromQuickAdd;
  const data = state.selectedMemoId
    ? await request(`/memos/${state.selectedMemoId}`, { method: 'PATCH', body: JSON.stringify(payload) })
    : await request('/memos', { method: 'POST', body: JSON.stringify(payload) });
  if (shouldClearQuickDraft && $('quickMemoTitle')) $('quickMemoTitle').value = '';
  closeMemoModal();
  await syncMemoMutationOrReload(data);
}

async function deleteMemo() {
  if (!state.selectedMemoId || !confirm('确认删除这个备忘录？')) return;
  const memoId = state.selectedMemoId;
  await request(`/memos/${memoId}`, { method: 'DELETE' });
  closeMemoModal();
  removeMemosLocally(memoId);
}

function openDailyDetailModal(date) {
  const targetDate = date instanceof Date ? date : new Date(date);
  state.dailyDetailDate = targetDate;
  const dateStr = `${targetDate.getFullYear()}年${targetDate.getMonth() + 1}月${targetDate.getDate()}日`;
  const dateTitle = $('dailyDetailDate');
  if (dateTitle) dateTitle.textContent = dateStr;
  loadDailyDetailMemos(targetDate);
  $('dailyDetailModal')?.classList.add('active');
}

function closeDailyDetailModal() {
  $('dailyDetailModal').classList.remove('active');
}

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
  const dueDate = memo.dueTime ? new Date(memo.dueTime).toLocaleDateString('zh-CN') : '无截止日期';
  const content = String(memo.contentPreview ?? memo.content ?? '');
  const contentPreview = content
    ? `${content.replace(new RegExp('[#*`]', 'g'), '').slice(0, 60)}${Number(memo.contentLength || content.length) > 60 ? '...' : ''}`
    : '无内容';
  return `
    <div class="task-item" style="border-left-color:${memo.color || '#4361ee'}">
      <div class="task-header">
        <div class="task-title">${escapeHtml(memoFullTitle(memo))}</div>
        <div class="task-color" style="background-color:${memo.color || '#4361ee'}"></div>
      </div>
      <div class="task-due">
        <i class="far fa-calendar-alt"></i> ${dueDate} ${getCountdown(memo)}
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
  setActiveTab(tab);
  $('functionsModal').classList.add('active');
}

function closeFunctionsModal() {
  $('functionsModal').classList.remove('active');
}

function setActiveTab(tabName) {
  if (!canManageWorkspace()) return;
  if (tabName === 'opsMonitor' && state.user?.role !== 'admin') return;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
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
  if (!canManageWorkspace()) return;
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

  const startDate = new Date(start);
  const endDate = new Date(end);
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
  const results = await runWithConcurrency(tasks, 4, (task) => request('/memos', {
    method: 'POST',
    body: JSON.stringify({
      ownerId: task.ownerId,
      date: task.date,
      title,
      content,
      color: state.selectedTaskColor,
      dueTime: task.dueTime
    })
  }));
  alert(`已向 ${assigneeIds.length} 人发布 ${tasks.length} 条任务`);
  closeFunctionsModal();
  await syncMemoMutationOrReload({ memos: results.map((result) => result.memo).filter(Boolean) });
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
  return getVisibleMemos().filter((memo) => !memo.completed);
}

function reminderMemoTitle(memo) {
  const title = memo.title || '无标题';
  if (!canManageWorkspace() || !memo.ownerName) return title;
  return `${title}（${memo.ownerName}）`;
}

function updateReminderBadge() {
  const count = reminderMemos().length;
  const badge = $('reminderBadge');
  const bell = $('floatingReminder');
  if (!badge || !bell) return;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.style.display = count ? 'flex' : 'none';
  bell.classList.toggle('reminder-pulse', count > 0);
}

function showReminderModal() {
  const due = reminderMemos();
  $('reminderList').innerHTML = due.length
    ? due.map((memo) => {
      const reminderTime = memo.dueTime
        ? new Date(memo.dueTime).toLocaleString('zh-CN')
        : memo.date;
      return `
      <div class="reminder-item" data-memo-id="${memo.id}">
        <div class="reminder-item-title">${escapeHtml(reminderMemoTitle(memo))}</div>
        <div class="reminder-item-details">
          <span><i class="far fa-calendar"></i> ${escapeHtml(reminderTime)}</span>
        </div>
      </div>
    `;
    }).join('')
    : '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>暂无到期提醒</p></div>';
  updateRecentTasks();
  $('reminderModal').classList.add('active');
  updateReminderBadge();
}

function closeReminderModal() {
  $('reminderModal').classList.remove('active');
}

function openExcelExportPanel() {
  if (!canManageWorkspace()) return;
  openFunctionsModal('dataManagement');
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
    if (!confirm(`确认导入 ${memos.length} 条备忘录？导入会新增记录，不会覆盖现有数据。`)) return;

    let imported = 0;
    const importedMemos = [];
    for (const memo of memos) {
      const title = String(memo.title || '').trim();
      const date = String(memo.date || '').slice(0, 10);
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
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
      imported += 1;
    }

    if (importedMemos.length) syncMemosLocally(importedMemos);
    else if (imported) await loadMemos();
    alert(`导入完成：${imported} 条`);
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
  document.addEventListener('wheel', handleDayMemosWheel, { passive: false });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshMemosInBackground();
  });
  $('saveMemo').addEventListener('click', saveMemo);
  $('deleteMemo').addEventListener('click', deleteMemo);
  $('cancelMemo').addEventListener('click', closeMemoModal);
  $('closeMemoModal').addEventListener('click', closeMemoModal);
  $('memoContent').addEventListener('input', updateMarkdownPreview);
  $('memoContent').addEventListener('keydown', continueOrderedMemoLine);
  $('memoTextToolbar')?.addEventListener('click', handleMemoTextToolbarClick);
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
  $('toolbarPublish').addEventListener('click', () => openFunctionsModal('taskPublish'));
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
  $('refreshOpsStatus')?.addEventListener('click', refreshOpsStatus);
  $('markAllAsRead').addEventListener('click', closeReminderModal);
  $('searchInput').addEventListener('input', () => { $('clearSearch').style.display = $('searchInput').value.trim() ? 'block' : 'none'; renderMultiMonthCalendar(); });
  $('clearSearch').addEventListener('click', () => { $('searchInput').value = ''; $('clearSearch').style.display = 'none'; renderMultiMonthCalendar(); });
  $('monthCountSelect').value = String(state.monthsToShow);
  $('monthCountSelect').addEventListener('change', async (event) => { state.monthsToShow = Number(event.target.value); localStorage.setItem('calendarMonthCount', String(state.monthsToShow)); await loadMemos(); });
  ['prevMonth', 'calendarPrevMonth'].forEach((id) => $(id)?.addEventListener('click', async () => { state.currentDate.setMonth(state.currentDate.getMonth() - 1); await loadMemos(); }));
  ['nextMonth', 'calendarNextMonth'].forEach((id) => $(id)?.addEventListener('click', async () => { state.currentDate.setMonth(state.currentDate.getMonth() + 1); await loadMemos(); }));
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
    toggleTheme();
  });

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setActiveTab(tab.dataset.tab)));

  document.addEventListener('click', async (event) => {
    const themeToggle = event.target.closest('#loginThemeToggle, #themeToggleBtn');
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
    const leaderboardTarget = event.target.closest('.leaderboard-card[data-user-id], .leaderboard-champion[data-user-id]');
    if (leaderboardTarget) { event.stopPropagation(); jumpToUserCalendar(leaderboardTarget.dataset.userId); return; }
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
    const statusFilter = event.target.closest('.stat-item[data-status-filter]');
    if (statusFilter) { event.stopPropagation(); setCalendarStatusFilter(statusFilter.dataset.statusFilter); return; }
    const reminder = event.target.closest('.reminder-item[data-memo-id]');
    if (reminder) { closeReminderModal(); await openMemoModal(reminder.dataset.memoId); return; }
    const day = event.target.closest('.calendar-day[data-date]');
    if (day) { openDailyDetailModal(day.dataset.date); return; }
    const complete = event.target.closest('.complete-all-btn');
    if (complete) { await completeAllMemosForMonth(complete.dataset.month); }
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

injectServerCss();
initSystemThemeListener();
initEventListeners();
patchStaticText();
restoreSession();