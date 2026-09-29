#![windows_subsystem = "windows"]

mod api;
mod models;
mod theme;
mod ui_login;
mod ui_modals;
mod ui_workspace;

use crate::api::ApiClient;
use crate::models::{
    Memo, NotificationItem, User, current_year_month, monday_of_date, month_key, next_day_str,
    shift_days, short_md, today_date_str,
};
use crate::theme::{ThemeMode, ThemePalette};
use gpui::{
    App, Application, Bounds, Context, FocusHandle, Focusable, IntoElement, MouseButton,
    ParentElement, Render, Rgba, Styled, Window, WindowBounds, WindowOptions, div, prelude::*, px,
    rgb, size,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuthTab {
    Login,
    Register,
    Password,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActiveTab {
    Calendar,
    WeeklyPlan,
    Dashboard,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActiveInput {
    None,
    LoginUsername,
    LoginPassword,
    RegUsername,
    RegJobTitle,
    RegPassword,
    RegPasswordConfirm,
    PwdUsername,
    PwdOld,
    PwdNew,
    SearchQuery,
    EditorTitle,
    EditorDate,
    EditorDueTime,
    EditorContent,
    WeeklyDayInput(usize),
    WeeklyGoals,
    WeeklyDeliverables,
    WeeklyActual,
    WeeklyRisks,
    TaskPubTitle,
    TaskPubDate,
    TaskPubContent,
}

#[derive(Clone, Debug)]
struct MemberStat {
    user_id: i64,
    name: String,
    job_title: String,
    department: String,
    total: usize,
    completed: usize,
    pending: usize,
    liked: usize,
    reviewed: usize,
    rate: usize,
}

#[derive(Serialize, Deserialize, Default)]
struct SavedCredentials {
    username: String,
    password: String,
    remember: bool,
}

fn saved_credentials_path() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("work-calendar-gpui-auth.json")
    } else {
        std::env::temp_dir().join("work-calendar-gpui-auth.json")
    }
}

fn load_saved_credentials() -> SavedCredentials {
    let p = saved_credentials_path();
    if let Ok(text) = std::fs::read_to_string(p) {
        if let Ok(creds) = serde_json::from_str::<SavedCredentials>(&text) {
            return creds;
        }
    }
    SavedCredentials {
        username: "admin".to_string(),
        password: "0000".to_string(),
        remember: true,
    }
}

fn persist_saved_credentials(creds: &SavedCredentials) {
    let p = saved_credentials_path();
    if let Ok(json_str) = serde_json::to_string_pretty(creds) {
        let _ = std::fs::write(p, json_str);
    }
}

struct WorkCalendarApp {
    focus_handle: FocusHandle,
    api: ApiClient,
    theme_mode: ThemeMode,

    // Auth & Login Screen state
    current_user: Option<User>,
    auth_tab: AuthTab,
    login_username: String,
    login_password: String,
    login_remember: bool,
    show_password: bool,
    reg_username: String,
    reg_job_title: String,
    reg_password: String,
    reg_password_confirm: String,
    pwd_username: String,
    pwd_old: String,
    pwd_new: String,
    login_error: Option<String>,
    login_success: Option<String>,
    is_loading: bool,

    // Live Data state
    users: Vec<User>,
    memos: Vec<Memo>,
    reminders: Vec<Memo>,
    notifications: Vec<NotificationItem>,

    // Navigation & Header Dropdown state
    active_tab: ActiveTab,
    sidebar_collapsed: bool,
    leaderboard_expanded: bool,
    current_year: i32,
    current_month: u32,
    month_count: usize,
    selected_user_filter: String, // "all" or user.id.to_string()
    member_dropdown_open: bool,
    month_dropdown_open: bool,
    search_query: String,
    active_input: ActiveInput,

    // Toast feedback
    toast_message: Option<String>,

    // Praise / Urge Calendar Highlighting closed-loop state
    highlight_memo_ids: Vec<i64>,
    highlight_index: usize,
    highlight_tick: usize,

    // Memo Edit Modal state (matches Web #memoModal)
    editor_open: bool,
    editor_memo_id: Option<i64>,
    editor_owner_id: Option<i64>,
    editor_owner_name: String,
    editor_date: String,
    editor_due_time: String,
    editor_title: String,
    editor_content: String,
    editor_color: String,
    editor_completed: bool,
    editor_in_weekly_plan: bool,
    editor_is_reviewed: bool,
    editor_is_liked: bool,
    editor_is_urged: bool,

    // Task Publish Modal (Manager 🚀 任务发布)
    task_pub_open: bool,
    task_pub_target_uid: Option<i64>,
    task_pub_title: String,
    task_pub_date: String,
    task_pub_content: String,

    // Reminder Modal state
    reminder_modal_open: bool,

    // Weekly Plan & Report state
    current_week_monday: String,
    weekly_team_mode: bool,
    weekly_summary_modal_open: bool,
    weekly_report_preview_open: bool,
    weekly_day_inputs: [String; 7],
    weekly_goals: String,
    weekly_deliverables: String,
    weekly_actual: String,
    weekly_risks: String,
}

impl Focusable for WorkCalendarApp {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

fn parse_hex_color(hex: &str) -> Rgba {
    let clean = hex.trim().trim_start_matches('#');
    if let Ok(val) = u32::from_str_radix(clean, 16) {
        if clean.len() == 6 {
            return rgb(val);
        }
    }
    rgb(0x2563eb)
}

impl WorkCalendarApp {
    fn new(cx: &mut Context<Self>) -> Self {
        let (year, month) = current_year_month();
        let today = today_date_str();
        let monday = monday_of_date(&today);
        let saved = load_saved_credentials();

        Self {
            focus_handle: cx.focus_handle(),
            api: ApiClient::default_production(),
            theme_mode: ThemeMode::Light,
            current_user: None,
            auth_tab: AuthTab::Login,
            login_username: if saved.remember && !saved.username.is_empty() {
                saved.username
            } else {
                "admin".to_string()
            },
            login_password: if saved.remember && !saved.password.is_empty() {
                saved.password
            } else {
                "0000".to_string()
            },
            login_remember: saved.remember,
            show_password: false,
            reg_username: String::new(),
            reg_job_title: String::new(),
            reg_password: String::new(),
            reg_password_confirm: String::new(),
            pwd_username: String::new(),
            pwd_old: String::new(),
            pwd_new: String::new(),
            login_error: None,
            login_success: None,
            is_loading: false,
            users: Vec::new(),
            memos: Vec::new(),
            reminders: Vec::new(),
            notifications: Vec::new(),
            active_tab: ActiveTab::Calendar,
            sidebar_collapsed: false,
            leaderboard_expanded: false,
            current_year: year,
            current_month: month,
            month_count: 1,
            selected_user_filter: "all".to_string(),
            member_dropdown_open: false,
            month_dropdown_open: false,
            search_query: String::new(),
            active_input: ActiveInput::None,
            toast_message: None,
            highlight_memo_ids: Vec::new(),
            highlight_index: 0,
            highlight_tick: 0,
            editor_open: false,
            editor_memo_id: None,
            editor_owner_id: None,
            editor_owner_name: String::new(),
            editor_date: today.clone(),
            editor_due_time: format!("{} 18:00", today),
            editor_title: String::new(),
            editor_content: String::new(),
            editor_color: "#3b82f6".to_string(),
            editor_completed: false,
            editor_in_weekly_plan: false,
            editor_is_reviewed: false,
            editor_is_liked: false,
            editor_is_urged: false,
            task_pub_open: false,
            task_pub_target_uid: None,
            task_pub_title: String::new(),
            task_pub_date: today,
            task_pub_content: String::new(),
            reminder_modal_open: false,
            current_week_monday: monday,
            weekly_team_mode: false,
            weekly_summary_modal_open: false,
            weekly_report_preview_open: false,
            weekly_day_inputs: Default::default(),
            weekly_goals: String::new(),
            weekly_deliverables: String::new(),
            weekly_actual: String::new(),
            weekly_risks: String::new(),
        }
    }

    fn show_toast(&mut self, msg: impl Into<String>, cx: &mut Context<Self>) {
        let text = msg.into();
        self.toast_message = Some(text.clone());
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(3200))
                .await;
            this.update(cx, |this, cx| {
                if this.toast_message.as_deref() == Some(text.as_str()) {
                    this.toast_message = None;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    fn handle_keystroke(
        &mut self,
        key: &str,
        key_char: Option<&str>,
        ctrl: bool,
        cx: &mut Context<Self>,
    ) {
        if self.active_input == ActiveInput::None {
            return;
        }
        if key == "escape" {
            self.active_input = ActiveInput::None;
            self.member_dropdown_open = false;
            self.month_dropdown_open = false;
            cx.notify();
            return;
        }
        if key == "enter" {
            match self.active_input {
                ActiveInput::LoginUsername | ActiveInput::LoginPassword => {
                    self.perform_login(cx);
                    return;
                }
                ActiveInput::RegUsername
                | ActiveInput::RegJobTitle
                | ActiveInput::RegPassword
                | ActiveInput::RegPasswordConfirm => {
                    self.perform_register(cx);
                    return;
                }
                ActiveInput::PwdUsername | ActiveInput::PwdOld | ActiveInput::PwdNew => {
                    self.perform_change_password(cx);
                    return;
                }
                ActiveInput::WeeklyDayInput(day_idx) => {
                    self.quick_create_weekly_plan_item(day_idx, cx);
                    return;
                }
                _ => {}
            }
        }

        let is_multiline = matches!(
            self.active_input,
            ActiveInput::EditorContent
                | ActiveInput::WeeklyGoals
                | ActiveInput::WeeklyDeliverables
                | ActiveInput::WeeklyActual
                | ActiveInput::WeeklyRisks
                | ActiveInput::TaskPubContent
        );

        let target: &mut String = match self.active_input {
            ActiveInput::None => return,
            ActiveInput::LoginUsername => &mut self.login_username,
            ActiveInput::LoginPassword => &mut self.login_password,
            ActiveInput::RegUsername => &mut self.reg_username,
            ActiveInput::RegJobTitle => &mut self.reg_job_title,
            ActiveInput::RegPassword => &mut self.reg_password,
            ActiveInput::RegPasswordConfirm => &mut self.reg_password_confirm,
            ActiveInput::PwdUsername => &mut self.pwd_username,
            ActiveInput::PwdOld => &mut self.pwd_old,
            ActiveInput::PwdNew => &mut self.pwd_new,
            ActiveInput::SearchQuery => &mut self.search_query,
            ActiveInput::EditorTitle => &mut self.editor_title,
            ActiveInput::EditorDate => &mut self.editor_date,
            ActiveInput::EditorDueTime => &mut self.editor_due_time,
            ActiveInput::EditorContent => &mut self.editor_content,
            ActiveInput::WeeklyDayInput(idx) => &mut self.weekly_day_inputs[idx.min(6)],
            ActiveInput::WeeklyGoals => &mut self.weekly_goals,
            ActiveInput::WeeklyDeliverables => &mut self.weekly_deliverables,
            ActiveInput::WeeklyActual => &mut self.weekly_actual,
            ActiveInput::WeeklyRisks => &mut self.weekly_risks,
            ActiveInput::TaskPubTitle => &mut self.task_pub_title,
            ActiveInput::TaskPubDate => &mut self.task_pub_date,
            ActiveInput::TaskPubContent => &mut self.task_pub_content,
        };

        if ctrl && key.eq_ignore_ascii_case("v") {
            if let Some(clip) = cx.read_from_clipboard().and_then(|c| c.text()) {
                if is_multiline {
                    target.push_str(&clip);
                } else {
                    target.push_str(&clip.replace('\n', " ").replace('\r', ""));
                }
                cx.notify();
            }
            return;
        }

        if key == "backspace" {
            target.pop();
            cx.notify();
            return;
        }

        if key == "enter" && is_multiline {
            target.push('\n');
            cx.notify();
            return;
        }

        if key == "space" {
            target.push(' ');
            cx.notify();
            return;
        }

        if !ctrl {
            if let Some(ch) = key_char {
                if !ch.is_empty() && !ch.chars().all(|c| c.is_control()) {
                    target.push_str(ch);
                    cx.notify();
                    return;
                }
            }
            if key.len() == 1 {
                target.push_str(key);
                cx.notify();
            }
        }
    }

    fn perform_login(&mut self, cx: &mut Context<Self>) {
        if self.is_loading {
            return;
        }
        let username = self.login_username.trim().to_string();
        let password = self.login_password.clone();
        if username.is_empty() || password.is_empty() {
            self.login_error = Some("请输入账号和密码".to_string());
            cx.notify();
            return;
        }
        if self.login_remember {
            persist_saved_credentials(&SavedCredentials {
                username: username.clone(),
                password: password.clone(),
                remember: true,
            });
        } else {
            persist_saved_credentials(&SavedCredentials {
                username: String::new(),
                password: String::new(),
                remember: false,
            });
        }

        self.is_loading = true;
        self.login_error = None;
        self.login_success = None;
        self.active_input = ActiveInput::None;
        cx.notify();

        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move { api.login(&username, &password) })
                .await;

            this.update(cx, |this, cx| {
                this.is_loading = false;
                match res {
                    Ok((token, user)) => {
                        this.finish_auth_login(token, user, cx);
                    }
                    Err(e) => {
                        this.login_error = Some(e.to_string());
                        cx.notify();
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    fn perform_register(&mut self, cx: &mut Context<Self>) {
        if self.is_loading {
            return;
        }
        let username = self.reg_username.trim().to_string();
        let job_title = self.reg_job_title.trim().to_string();
        let password = self.reg_password.clone();
        let confirm = self.reg_password_confirm.clone();

        if username.is_empty() || password.is_empty() {
            self.login_error = Some("请填写登录账号和设置密码".to_string());
            cx.notify();
            return;
        }
        if password.len() < 4 {
            self.login_error = Some("密码长度至少为 4 位".to_string());
            cx.notify();
            return;
        }
        if password != confirm {
            self.login_error = Some("两次输入的密码不一致".to_string());
            cx.notify();
            return;
        }

        self.is_loading = true;
        self.login_error = None;
        self.login_success = None;
        cx.notify();

        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move {
                    api.register_account(&username, &password, &username, &job_title)
                })
                .await;

            this.update(cx, |this, cx| {
                this.is_loading = false;
                match res {
                    Ok((token, user)) => {
                        this.finish_auth_login(token, user, cx);
                    }
                    Err(e) => {
                        this.login_error = Some(e.to_string());
                        cx.notify();
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    fn perform_change_password(&mut self, cx: &mut Context<Self>) {
        if self.is_loading {
            return;
        }
        let username = self.pwd_username.trim().to_string();
        let old_pwd = self.pwd_old.clone();
        let new_pwd = self.pwd_new.clone();

        if username.is_empty() || old_pwd.is_empty() || new_pwd.is_empty() {
            self.login_error = Some("请完整填写账号、原密码与新密码".to_string());
            cx.notify();
            return;
        }
        if new_pwd.len() < 4 {
            self.login_error = Some("新密码长度至少为 4 位".to_string());
            cx.notify();
            return;
        }

        self.is_loading = true;
        self.login_error = None;
        self.login_success = None;
        cx.notify();

        let api = self.api.clone();
        let user_clone = username.clone();
        let new_pwd_clone = new_pwd.clone();
        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move { api.change_password(&username, &old_pwd, &new_pwd) })
                .await;

            this.update(cx, |this, cx| {
                this.is_loading = false;
                match res {
                    Ok(msg) => {
                        this.login_username = user_clone;
                        this.login_password = new_pwd_clone;
                        this.auth_tab = AuthTab::Login;
                        this.login_success = Some(msg);
                        cx.notify();
                    }
                    Err(e) => {
                        this.login_error = Some(e.to_string());
                        cx.notify();
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    fn finish_auth_login(&mut self, token: String, user: User, cx: &mut Context<Self>) {
        let is_admin = user.is_admin();
        let display_name = user.name().to_string();
        self.api.token = Some(token);
        self.current_user = Some(user);
        self.month_count = if is_admin { 2 } else { 1 };
        self.selected_user_filter = "all".to_string();
        self.show_toast(
            format!(
                "欢迎回来，{}（{}）",
                display_name,
                if is_admin { "管理端" } else { "员工端" }
            ),
            cx,
        );
        self.refresh_all_data(cx);
    }

    fn quick_login_as(&mut self, username: &str, password: &str, cx: &mut Context<Self>) {
        self.auth_tab = AuthTab::Login;
        self.login_username = username.to_string();
        self.login_password = password.to_string();
        self.perform_login(cx);
    }

    fn refresh_all_data(&mut self, cx: &mut Context<Self>) {
        let Some(user) = self.current_user.clone() else {
            return;
        };
        let is_admin = user.is_admin();
        let api = self.api.clone();
        let start_month = month_key(self.current_year, self.current_month);
        let months = self.month_count.max(2);
        let user_filter = if is_admin {
            self.selected_user_filter.clone()
        } else {
            user.id.to_string()
        };
        let week_monday = self.current_week_monday.clone();

        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move {
                    let users = if is_admin {
                        api.fetch_users().unwrap_or_default()
                    } else {
                        vec![user]
                    };
                    let memos = api
                        .fetch_memos(&start_month, months, &user_filter)
                        .unwrap_or_default();
                    let reminders = api.fetch_reminders().unwrap_or_default();
                    let notifications = api.fetch_notifications().unwrap_or_default();
                    let summaries = api
                        .fetch_weekly_summaries(&week_monday, &user_filter)
                        .unwrap_or_default();
                    (users, memos, reminders, notifications, summaries)
                })
                .await;

            this.update(cx, |this, cx| {
                this.users = res.0;
                this.memos = res.1;
                this.reminders = res.2;
                this.notifications = res.3;
                if let Some(sum) = res.4.first() {
                    this.weekly_goals = sum.goals.clone();
                    this.weekly_deliverables = sum.deliverables.clone();
                    this.weekly_actual = sum.actual.clone();
                    this.weekly_risks = sum.risks.clone();
                } else {
                    this.weekly_goals.clear();
                    this.weekly_deliverables.clear();
                    this.weekly_actual.clear();
                    this.weekly_risks.clear();
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn start_highlight_memos(&mut self, memo_ids: Vec<i64>, cx: &mut Context<Self>) {
        if memo_ids.is_empty() {
            self.show_toast("当前视图未找到对应的日历事项", cx);
            return;
        }
        self.active_tab = ActiveTab::Calendar;
        self.highlight_memo_ids = memo_ids;
        self.highlight_index = 0;
        self.focus_current_highlighted_memo(cx);
    }

    fn focus_current_highlighted_memo(&mut self, cx: &mut Context<Self>) {
        if let Some(&target_id) = self.highlight_memo_ids.get(self.highlight_index) {
            if let Some(memo) = self.memos.iter().find(|m| m.id == target_id) {
                let parts: Vec<&str> = memo.date.split('-').collect();
                if parts.len() >= 2 {
                    if let (Ok(y), Ok(m)) = (parts[0].parse::<i32>(), parts[1].parse::<u32>()) {
                        self.current_year = y;
                        self.current_month = m;
                    }
                }
            }
        }
        self.highlight_tick = 10;
        cx.notify();

        cx.spawn(async move |this, cx| {
            for _ in 0..10 {
                cx.background_executor()
                    .timer(Duration::from_millis(360))
                    .await;
                let keep_going = this
                    .update(cx, |this, cx| {
                        if this.highlight_tick > 0 {
                            this.highlight_tick -= 1;
                            cx.notify();
                            this.highlight_tick > 0
                        } else {
                            false
                        }
                    })
                    .unwrap_or(false);
                if !keep_going {
                    break;
                }
            }
        })
        .detach();
    }

    fn dismiss_praise_notifications(&mut self, ids: Vec<i64>, cx: &mut Context<Self>) {
        let api = self.api.clone();
        self.notifications.retain(|n| !ids.contains(&n.id));
        self.highlight_memo_ids.clear();
        self.highlight_tick = 0;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let _ = cx
                .background_executor()
                .spawn(async move { api.mark_notifications_read(&ids) })
                .await;
            this.update(cx, |this, cx| {
                this.show_toast("已标记审阅/点赞通知为已读", cx);
            })
            .ok();
        })
        .detach();
    }

    fn open_new_memo_editor(&mut self, date_str: &str, in_weekly: bool, cx: &mut Context<Self>) {
        let default_owner = self.current_user.as_ref().map(|u| u.id);
        let default_owner_name = self
            .current_user
            .as_ref()
            .map(|u| u.name().to_string())
            .unwrap_or_default();
        self.editor_open = true;
        self.editor_memo_id = None;
        self.editor_owner_id = default_owner;
        self.editor_owner_name = default_owner_name;
        self.editor_date = date_str.to_string();
        self.editor_due_time = format!("{} 18:00", date_str);
        self.editor_title.clear();
        self.editor_content.clear();
        self.editor_color = "#3b82f6".to_string();
        self.editor_completed = false;
        self.editor_in_weekly_plan = in_weekly;
        self.editor_is_reviewed = false;
        self.editor_is_liked = false;
        self.editor_is_urged = false;
        self.active_input = ActiveInput::EditorTitle;
        cx.notify();
    }

    fn open_existing_memo_editor(&mut self, memo: &Memo, cx: &mut Context<Self>) {
        let mid = memo.id;
        self.editor_open = true;
        self.editor_memo_id = Some(mid);
        self.editor_owner_id = Some(memo.owner_id);
        self.editor_owner_name = if memo.owner_name.is_empty() {
            format!("成员#{}", memo.owner_id)
        } else {
            memo.owner_name.clone()
        };
        self.editor_date = memo.date.clone();
        self.editor_due_time = memo
            .due_time
            .as_deref()
            .map(|s| s.replace('T', " ").chars().take(16).collect())
            .unwrap_or_else(|| format!("{} 18:00", memo.date));
        self.editor_title = memo.title.clone();
        self.editor_content = memo.body_text().to_string();
        self.editor_color = memo.color.clone();
        self.editor_completed = memo.completed;
        self.editor_in_weekly_plan = memo.plan_kind == "weekly";
        self.editor_is_reviewed = memo.is_reviewed;
        self.editor_is_liked = memo.is_liked;
        self.editor_is_urged = memo.is_urged;
        self.active_input = ActiveInput::EditorTitle;
        cx.notify();

        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            if let Ok(full_memo) = cx
                .background_executor()
                .spawn(async move { api.fetch_memo_detail(mid) })
                .await
            {
                this.update(cx, |this, cx| {
                    if this.editor_open && this.editor_memo_id == Some(mid) {
                        this.editor_content = full_memo.body_text().to_string();
                        cx.notify();
                    }
                })
                .ok();
            }
        })
        .detach();
    }

    fn save_editor_memo(&mut self, cx: &mut Context<Self>) {
        let title = self.editor_title.trim().to_string();
        if title.is_empty() {
            self.show_toast("请填写备忘录标题", cx);
            return;
        }
        let date = self.editor_date.trim().to_string();
        let due_iso = {
            let raw = self.editor_due_time.trim().replace(' ', "T");
            if raw.len() == 16 {
                format!("{}:00", raw)
            } else if raw.is_empty() {
                format!("{}T18:00:00", date)
            } else {
                raw
            }
        };
        let content = self.editor_content.trim().to_string();
        let color = self.editor_color.clone();
        let completed = self.editor_completed;
        let plan_kind = if self.editor_in_weekly_plan {
            "weekly".to_string()
        } else {
            "memo".to_string()
        };
        let memo_id = self.editor_memo_id;
        let owner_id = self.editor_owner_id;
        let api = self.api.clone();

        self.editor_open = false;
        self.active_input = ActiveInput::None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move {
                    if let Some(id) = memo_id {
                        api.update_memo_ext(
                            id,
                            Some(&date),
                            Some(&title),
                            Some(&content),
                            Some(&color),
                            Some(completed),
                            Some(&plan_kind),
                            Some(&due_iso),
                        )
                    } else {
                        api.create_memo_ext(
                            owner_id,
                            &date,
                            &title,
                            &content,
                            &color,
                            completed,
                            &plan_kind,
                            Some(&due_iso),
                        )
                    }
                })
                .await;

            this.update(cx, |this, cx| match res {
                Ok(_) => {
                    this.show_toast(
                        if memo_id.is_some() {
                            "✅ 备忘录已保存更新"
                        } else {
                            "✅ 新备忘录已创建"
                        },
                        cx,
                    );
                    this.refresh_all_data(cx);
                }
                Err(e) => {
                    this.show_toast(format!("保存失败: {}", e), cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn delete_editor_memo(&mut self, memo_id: i64, cx: &mut Context<Self>) {
        let api = self.api.clone();
        self.editor_open = false;
        self.active_input = ActiveInput::None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move { api.delete_memo(memo_id) })
                .await;
            this.update(cx, |this, cx| match res {
                Ok(_) => {
                    this.show_toast("🗑️ 备忘录已删除", cx);
                    this.refresh_all_data(cx);
                }
                Err(e) => this.show_toast(format!("删除失败: {}", e), cx),
            })
            .ok();
        })
        .detach();
    }

    fn toggle_memo_completed(&mut self, memo_id: i64, new_completed: bool, cx: &mut Context<Self>) {
        if let Some(m) = self.memos.iter_mut().find(|m| m.id == memo_id) {
            m.completed = new_completed;
        }
        if self.editor_memo_id == Some(memo_id) {
            self.editor_completed = new_completed;
        }
        cx.notify();

        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move {
                    api.update_memo(memo_id, None, None, None, Some(new_completed))
                })
                .await;
            this.update(cx, |this, cx| {
                if res.is_ok() {
                    this.show_toast(
                        if new_completed {
                            "✅ 已标记为完成"
                        } else {
                            "⏳ 已恢复为进行中"
                        },
                        cx,
                    );
                    this.refresh_all_data(cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn trigger_carryover(&mut self, memo: Memo, cx: &mut Context<Self>) {
        let next_date = next_day_str(&memo.date);
        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move { api.carryover_to_next_day(&memo) })
                .await;
            this.update(cx, |this, cx| match res {
                Ok(_) => {
                    this.show_toast(format!("↪ 已结转至下一天 ({})", next_date), cx);
                    this.refresh_all_data(cx);
                }
                Err(e) => this.show_toast(format!("结转失败: {}", e), cx),
            })
            .ok();
        })
        .detach();
    }

    fn trigger_manager_react(
        &mut self,
        memo_id: i64,
        action: &'static str,
        cx: &mut Context<Self>,
    ) {
        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move { api.react_memo(memo_id, action) })
                .await;
            this.update(cx, |this, cx| match res {
                Ok((is_reviewed, is_liked)) => {
                    if let Some(m) = this.memos.iter_mut().find(|m| m.id == memo_id) {
                        m.is_reviewed = is_reviewed;
                        m.is_liked = is_liked;
                    }
                    if this.editor_memo_id == Some(memo_id) {
                        this.editor_is_reviewed = is_reviewed;
                        this.editor_is_liked = is_liked;
                    }
                    let msg = match action {
                        "review" => {
                            if is_reviewed {
                                "✓ 已标记「已审阅」并通知员工"
                            } else {
                                "已取消「已审阅」标记"
                            }
                        }
                        "like" => {
                            if is_liked {
                                "👍 已发送「点赞认可」给员工"
                            } else {
                                "已取消「点赞」标记"
                            }
                        }
                        _ => "操作成功",
                    };
                    this.show_toast(msg, cx);
                    cx.notify();
                }
                Err(e) => this.show_toast(format!("操作失败: {}", e), cx),
            })
            .ok();
        })
        .detach();
    }

    fn trigger_manager_urge(&mut self, memo_id: i64, cx: &mut Context<Self>) {
        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move { api.urge_memo(memo_id) })
                .await;
            this.update(cx, |this, cx| match res {
                Ok(_) => {
                    if let Some(m) = this.memos.iter_mut().find(|m| m.id == memo_id) {
                        m.is_urged = true;
                    }
                    if this.editor_memo_id == Some(memo_id) {
                        this.editor_is_urged = true;
                    }
                    this.show_toast("⚡ 已向员工下发催办提醒", cx);
                    cx.notify();
                }
                Err(e) => this.show_toast(format!("催办失败: {}", e), cx),
            })
            .ok();
        })
        .detach();
    }

    fn quick_create_weekly_plan_item(&mut self, day_idx: usize, cx: &mut Context<Self>) {
        let idx = day_idx.min(6);
        let title = self.weekly_day_inputs[idx].trim().to_string();
        if title.is_empty() {
            return;
        }
        self.weekly_day_inputs[idx].clear();
        let date_str = shift_days(&self.current_week_monday, idx as i64);
        let date_label = short_md(&date_str);
        let owner_id = self.current_user.as_ref().map(|u| u.id);
        let api = self.api.clone();
        cx.notify();

        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move {
                    api.create_memo_ext(
                        owner_id,
                        &date_str,
                        &title,
                        "",
                        "#3b82f6",
                        false,
                        "weekly",
                        None,
                    )
                })
                .await;
            this.update(cx, |this, cx| match res {
                Ok(_) => {
                    this.show_toast(format!("✅ 已添加周计划 ({})", date_label), cx);
                    this.refresh_all_data(cx);
                }
                Err(e) => this.show_toast(format!("添加周计划失败: {}", e), cx),
            })
            .ok();
        })
        .detach();
    }

    fn publish_manager_task(&mut self, cx: &mut Context<Self>) {
        let title = self.task_pub_title.trim().to_string();
        if title.is_empty() {
            self.show_toast("请输入要发布的任务标题", cx);
            return;
        }
        let date_str = self.task_pub_date.trim().to_string();
        let content = self.task_pub_content.trim().to_string();
        let target_uid = self.task_pub_target_uid;
        let all_emp_ids: Vec<i64> = self
            .users
            .iter()
            .filter(|u| !u.is_admin())
            .map(|u| u.id)
            .collect();
        let target_ids: Vec<i64> = if let Some(uid) = target_uid {
            vec![uid]
        } else if !all_emp_ids.is_empty() {
            all_emp_ids
        } else if let Some(u) = &self.current_user {
            vec![u.id]
        } else {
            vec![]
        };

        self.task_pub_open = false;
        self.active_input = ActiveInput::None;
        cx.notify();

        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let count = cx
                .background_executor()
                .spawn(async move {
                    let mut ok_cnt = 0usize;
                    for uid in target_ids {
                        if api
                            .create_memo_ext(
                                Some(uid),
                                &date_str,
                                &format!("[指派] {}", title),
                                &content,
                                "#8b5cf6",
                                false,
                                "weekly",
                                None,
                            )
                            .is_ok()
                        {
                            ok_cnt += 1;
                        }
                    }
                    ok_cnt
                })
                .await;
            this.update(cx, |this, cx| {
                this.show_toast(format!("🚀 已成功向 {} 名成员下发工作任务", count), cx);
                this.refresh_all_data(cx);
            })
            .ok();
        })
        .detach();
    }

    fn export_memos_csv(&mut self, cx: &mut Context<Self>) {
        let mut csv = String::from("\u{FEFF}日期,负责人,部门,事项标题,状态,已审阅,已点赞,备注内容\n");
        for m in &self.memos {
            let dept = m.department_name.as_deref().unwrap_or("研发部");
            let status = if m.completed { "已完成" } else { "进行中" };
            let rev = if m.is_reviewed { "是" } else { "否" };
            let like = if m.is_liked { "是" } else { "否" };
            let clean_title = m.title.replace('"', "\"\"");
            let clean_body = m
                .body_text()
                .replace('"', "\"\"")
                .replace('\n', " ")
                .replace('\r', "");
            csv.push_str(&format!(
                "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
                m.date, m.owner_name, dept, clean_title, status, rev, like, clean_body
            ));
        }
        let filename = format!(
            "工作日历导出_{:04}年{:02}月.csv",
            self.current_year, self.current_month
        );
        let out_path = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(&filename);
        if std::fs::write(&out_path, csv).is_ok() {
            self.show_toast(format!("📗 已导出报表至: {}", filename), cx);
        } else {
            self.show_toast("导出失败，请检查文件是否被占用", cx);
        }
    }

    fn generate_weekly_summary_from_memos(&mut self, cx: &mut Context<Self>) {
        let week_end = shift_days(&self.current_week_monday, 6);
        let week_memos: Vec<&Memo> = self
            .memos
            .iter()
            .filter(|m| m.date >= self.current_week_monday && m.date <= week_end)
            .collect();

        let mut completed_lines = Vec::new();
        let mut pending_lines = Vec::new();
        for m in &week_memos {
            let line = format!("• [{}] {}", short_md(&m.date), m.title);
            if m.completed {
                completed_lines.push(line);
            } else {
                pending_lines.push(line);
            }
        }

        if self.weekly_goals.trim().is_empty() && !week_memos.is_empty() {
            self.weekly_goals = format!("本周计划推进 {} 项研发与工作事项", week_memos.len());
        }
        self.weekly_actual = if completed_lines.is_empty() {
            "暂无已完成事项记录".to_string()
        } else {
            completed_lines.join("\n")
        };
        if !pending_lines.is_empty() {
            self.weekly_risks = format!(
                "待跟进结转事项（{} 项）：\n{}",
                pending_lines.len(),
                pending_lines.join("\n")
            );
        }
        self.show_toast("✨ 已从本周日历事项自动汇总生成周报草稿", cx);
        cx.notify();
    }

    fn save_current_weekly_summary(&mut self, cx: &mut Context<Self>) {
        let Some(user) = self.current_user.as_ref() else {
            return;
        };
        let owner_id = if user.is_admin() && self.selected_user_filter != "all" {
            self.selected_user_filter.parse::<i64>().unwrap_or(user.id)
        } else {
            user.id
        };
        let week_start = self.current_week_monday.clone();
        let goals = self.weekly_goals.clone();
        let deliverables = self.weekly_deliverables.clone();
        let actual = self.weekly_actual.clone();
        let risks = self.weekly_risks.clone();
        let api = self.api.clone();

        self.weekly_summary_modal_open = false;
        self.active_input = ActiveInput::None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move {
                    api.save_weekly_summary(
                        &week_start,
                        owner_id,
                        &goals,
                        &deliverables,
                        &actual,
                        &risks,
                    )
                })
                .await;
            this.update(cx, |this, cx| match res {
                Ok(_) => this.show_toast("💾 周目标与复盘已保存至服务器", cx),
                Err(e) => this.show_toast(format!("保存周报失败: {}", e), cx),
            })
            .ok();
        })
        .detach();
    }

    fn compute_leaderboard(&self) -> Vec<MemberStat> {
        let mut map: HashMap<i64, MemberStat> = HashMap::new();
        for u in &self.users {
            if u.is_admin() {
                continue;
            }
            map.insert(
                u.id,
                MemberStat {
                    user_id: u.id,
                    name: u.name().to_string(),
                    job_title: u
                        .job_title
                        .clone()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "研发工程师".to_string()),
                    department: u
                        .department_name
                        .clone()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "研发部".to_string()),
                    total: 0,
                    completed: 0,
                    pending: 0,
                    liked: 0,
                    reviewed: 0,
                    rate: 0,
                },
            );
        }

        for m in &self.memos {
            let entry = map.entry(m.owner_id).or_insert_with(|| MemberStat {
                user_id: m.owner_id,
                name: if m.owner_name.is_empty() {
                    format!("成员#{}", m.owner_id)
                } else {
                    m.owner_name.clone()
                },
                job_title: "研发工程师".to_string(),
                department: m
                    .department_name
                    .clone()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "研发部".to_string()),
                total: 0,
                completed: 0,
                pending: 0,
                liked: 0,
                reviewed: 0,
                rate: 0,
            });
            entry.total += 1;
            if m.completed {
                entry.completed += 1;
            } else {
                entry.pending += 1;
            }
            if m.is_liked {
                entry.liked += 1;
            }
            if m.is_reviewed {
                entry.reviewed += 1;
            }
        }

        let mut list: Vec<MemberStat> = map
            .into_values()
            .filter(|s| s.total > 0 || self.users.len() <= 8)
            .map(|mut s| {
                s.rate = if s.total > 0 {
                    (s.completed * 100) / s.total
                } else {
                    0
                };
                s
            })
            .collect();

        list.sort_by(|a, b| {
            b.rate
                .cmp(&a.rate)
                .then_with(|| b.completed.cmp(&a.completed))
                .then_with(|| b.liked.cmp(&a.liked))
        });
        list
    }

    fn filtered_memos_for_date(&self, date_str: &str) -> Vec<Memo> {
        let q = self.search_query.trim().to_lowercase();
        self.memos
            .iter()
            .filter(|m| {
                if m.date != date_str {
                    return false;
                }
                if self.selected_user_filter != "all" {
                    if m.owner_id.to_string() != self.selected_user_filter {
                        return false;
                    }
                }
                if !q.is_empty() {
                    let hit_title = m.title.to_lowercase().contains(&q);
                    let hit_body = m.body_text().to_lowercase().contains(&q);
                    let hit_owner = m.owner_name.to_lowercase().contains(&q);
                    if !hit_title && !hit_body && !hit_owner {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect()
    }

    fn filtered_memos_for_month(&self, ym_prefix: &str) -> Vec<Memo> {
        let q = self.search_query.trim().to_lowercase();
        self.memos
            .iter()
            .filter(|m| {
                if !m.date.starts_with(ym_prefix) {
                    return false;
                }
                if self.selected_user_filter != "all" {
                    if m.owner_id.to_string() != self.selected_user_filter {
                        return false;
                    }
                }
                if !q.is_empty() {
                    let hit_title = m.title.to_lowercase().contains(&q);
                    let hit_body = m.body_text().to_lowercase().contains(&q);
                    let hit_owner = m.owner_name.to_lowercase().contains(&q);
                    if !hit_title && !hit_body && !hit_owner {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect()
    }
}

impl Render for WorkCalendarApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = ThemePalette::for_mode(self.theme_mode);

        let Some(user) = self.current_user.clone() else {
            return div()
                .track_focus(&self.focus_handle)
                .size_full()
                .on_mouse_down(MouseButton::Left, |_, _window, _| {})
                .child(self.render_login_screen(palette, cx));
        };

        let show_dropdowns = self.member_dropdown_open || self.month_dropdown_open;
        let show_editor = self.editor_open;
        let show_wk_summary = self.weekly_summary_modal_open;
        let show_wk_preview = self.weekly_report_preview_open;
        let show_task_pub = self.task_pub_open;
        let show_reminders = self.reminder_modal_open;
        let show_hl_pager = !self.highlight_memo_ids.is_empty();
        let toast = self.toast_message.clone();

        div()
            .track_focus(&self.focus_handle)
            .relative()
            .size_full()
            .bg(palette.bg_app)
            .text_color(palette.text_primary)
            .flex()
            .overflow_hidden()
            // Left Sidebar
            .child(self.render_sidebar(&user, palette, cx))
            // Main Workspace Column
            .child(
                div()
                    .flex_1()
                    .h_full()
                    .flex()
                    .flex_col()
                    .overflow_hidden()
                    .child(self.render_top_header(&user, palette, cx))
                    .child(match self.active_tab {
                        ActiveTab::Calendar => {
                            self.render_calendar_tab(&user, palette, cx).into_any_element()
                        }
                        ActiveTab::WeeklyPlan => {
                            self.render_weekly_plan_tab(palette, cx).into_any_element()
                        }
                        ActiveTab::Dashboard => {
                            self.render_dashboard_tab(palette, cx).into_any_element()
                        }
                    }),
            )
            // Header Floating Dropdowns (Member / Month Count)
            .when(show_dropdowns, |el| {
                el.child(self.render_header_dropdowns(palette, cx))
            })
            // Highlight Pager Bar
            .when(show_hl_pager, |el| {
                el.child(self.render_highlight_pager(palette, cx))
            })
            // Memo Edit Modal
            .when(show_editor, |el| {
                el.child(self.render_editor_modal(&user, palette, cx))
            })
            // Weekly Summary Modal
            .when(show_wk_summary, |el| {
                el.child(self.render_weekly_summary_modal(palette, cx))
            })
            // Weekly Report Preview Modal
            .when(show_wk_preview, |el| {
                el.child(self.render_weekly_report_preview_modal(palette, cx))
            })
            // Manager Task Publish Modal
            .when(show_task_pub, |el| {
                el.child(self.render_task_publish_modal(palette, cx))
            })
            // Reminder Modal
            .when(show_reminders, |el| {
                el.child(self.render_reminder_modal(palette, cx))
            })
            // Toast notification
            .when_some(toast, |el, msg| {
                el.child(
                    div()
                        .absolute()
                        .bottom_5()
                        .right_5()
                        .px_4()
                        .py_2p5()
                        .rounded_xl()
                        .bg(palette.accent_primary)
                        .shadow_xl()
                        .text_xs()
                        .font_weight(gpui::FontWeight::BOLD)
                        .text_color(rgb(0xffffff))
                        .child(msg),
                )
            })
    }
}

fn main() {
    Application::new().run(|cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1440.0), px(900.0)), cx);
        let window = cx
            .open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(gpui::TitlebarOptions {
                        title: Some("智能网页工作日历备忘录 · 桌面版 v2.0".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                |_, cx| cx.new(|cx| WorkCalendarApp::new(cx)),
            )
            .unwrap();

        let view = window.update(cx, |_, _, cx| cx.entity()).unwrap();
        cx.observe_keystrokes(move |ev, _, cx| {
            view.update(cx, |app, cx| {
                let ks = &ev.keystroke;
                let ctrl = ks.modifiers.control || ks.modifiers.platform;
                app.handle_keystroke(&ks.key, ks.key_char.as_deref(), ctrl, cx);
            });
        })
        .detach();

        window
            .update(cx, |app, window, cx| {
                window.focus(&app.focus_handle(cx));
                cx.activate(true);
                let args: Vec<String> = std::env::args().collect();
                if args.iter().any(|a| a == "--admin") {
                    app.quick_login_as("admin", "0000", cx);
                } else if args.iter().any(|a| a == "--employee") {
                    app.quick_login_as("孔致镔", "0000", cx);
                }
            })
            .unwrap();
    });
}

