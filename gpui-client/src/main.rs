#![windows_subsystem = "windows"]

mod api;
mod models;
mod theme;

use crate::api::ApiClient;
use crate::models::{
    Memo, NotificationItem, User, build_month_cells, current_year_month, monday_of_date, month_key,
    next_day_str, shift_days, shift_month, today_date_str,
};
use crate::theme::{ThemeMode, ThemePalette};
use gpui::{
    App, Application, Bounds, Context, FocusHandle, Focusable, IntoElement, MouseButton,
    ParentElement, Render, Rgba, SharedString, StatefulInteractiveElement, Styled, Window,
    WindowBounds, WindowOptions, div, prelude::*, px, rgb, rgba, size,
};
use std::collections::HashMap;
use std::time::Duration;

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
    SearchQuery,
    EditorTitle,
    EditorDate,
    EditorContent,
    WeeklyGoals,
    WeeklyDeliverables,
    WeeklyActual,
    WeeklyRisks,
}

#[derive(Clone, Debug)]
struct MemberStat {
    user_id: i64,
    name: String,
    department: String,
    total: usize,
    completed: usize,
    pending: usize,
    liked: usize,
    reviewed: usize,
    rate: usize,
}

struct WorkCalendarApp {
    focus_handle: FocusHandle,
    api: ApiClient,
    theme_mode: ThemeMode,

    // Auth & Role state
    current_user: Option<User>,
    login_username: String,
    login_password: String,
    login_error: Option<String>,
    is_loading: bool,

    // Data state
    users: Vec<User>,
    memos: Vec<Memo>,
    reminders: Vec<Memo>,
    notifications: Vec<NotificationItem>,

    // Navigation & Layout state
    active_tab: ActiveTab,
    sidebar_collapsed: bool,
    leaderboard_expanded: bool,
    current_year: i32,
    current_month: u32,
    month_count: usize,
    selected_user_filter: String, // "all" or user.id.to_string()
    search_query: String,
    active_input: ActiveInput,

    // Toast feedback
    toast_message: Option<String>,

    // Praise / Urge Calendar Highlighting closed-loop state
    highlight_memo_ids: Vec<i64>,
    highlight_index: usize,
    highlight_tick: usize,

    // Memo Inspector / Editor Modal state
    editor_open: bool,
    editor_memo_id: Option<i64>,
    editor_owner_id: Option<i64>,
    editor_date: String,
    editor_title: String,
    editor_content: String,
    editor_color: String,
    editor_completed: bool,
    editor_is_reviewed: bool,
    editor_is_liked: bool,
    editor_is_urged: bool,
    editor_owner_name: String,

    // Reminder Modal state
    reminder_modal_open: bool,

    // Weekly Plan & Report state
    current_week_monday: String,
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
    rgb(0x3b82f6)
}

impl WorkCalendarApp {
    fn new(cx: &mut Context<Self>) -> Self {
        let (year, month) = current_year_month();
        let today = today_date_str();
        let monday = monday_of_date(&today);

        Self {
            focus_handle: cx.focus_handle(),
            api: ApiClient::default_production(),
            theme_mode: ThemeMode::Light,
            current_user: None,
            login_username: "admin".to_string(),
            login_password: "0000".to_string(),
            login_error: None,
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
            search_query: String::new(),
            active_input: ActiveInput::None,
            toast_message: None,
            highlight_memo_ids: Vec::new(),
            highlight_index: 0,
            highlight_tick: 0,
            editor_open: false,
            editor_memo_id: None,
            editor_owner_id: None,
            editor_date: today,
            editor_title: String::new(),
            editor_content: String::new(),
            editor_color: "#3b82f6".to_string(),
            editor_completed: false,
            editor_is_reviewed: false,
            editor_is_liked: false,
            editor_is_urged: false,
            editor_owner_name: String::new(),
            reminder_modal_open: false,
            current_week_monday: monday,
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

    fn handle_keystroke(&mut self, key: &str, key_char: Option<&str>, ctrl: bool, cx: &mut Context<Self>) {
        if self.active_input == ActiveInput::None {
            return;
        }
        if key == "escape" {
            self.active_input = ActiveInput::None;
            cx.notify();
            return;
        }
        if key == "enter" && (self.active_input == ActiveInput::LoginUsername || self.active_input == ActiveInput::LoginPassword) {
            self.perform_login(cx);
            return;
        }

        let target: &mut String = match self.active_input {
            ActiveInput::None => return,
            ActiveInput::LoginUsername => &mut self.login_username,
            ActiveInput::LoginPassword => &mut self.login_password,
            ActiveInput::SearchQuery => &mut self.search_query,
            ActiveInput::EditorTitle => &mut self.editor_title,
            ActiveInput::EditorDate => &mut self.editor_date,
            ActiveInput::EditorContent => &mut self.editor_content,
            ActiveInput::WeeklyGoals => &mut self.weekly_goals,
            ActiveInput::WeeklyDeliverables => &mut self.weekly_deliverables,
            ActiveInput::WeeklyActual => &mut self.weekly_actual,
            ActiveInput::WeeklyRisks => &mut self.weekly_risks,
        };

        let is_multiline = matches!(
            self.active_input,
            ActiveInput::EditorContent
                | ActiveInput::WeeklyGoals
                | ActiveInput::WeeklyDeliverables
                | ActiveInput::WeeklyActual
                | ActiveInput::WeeklyRisks
        );

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

        if ctrl && key.eq_ignore_ascii_case("u") {
            target.clear();
            cx.notify();
            return;
        }

        match key {
            "backspace" => {
                target.pop();
                cx.notify();
            }
            "enter" => {
                if is_multiline {
                    target.push('\n');
                    cx.notify();
                }
            }
            "space" => {
                target.push(' ');
                cx.notify();
            }
            _ => {
                if !ctrl {
                    if let Some(ch_str) = key_char {
                        if !ch_str.is_empty() && !ch_str.chars().all(|c| c.is_control()) {
                            target.push_str(ch_str);
                            cx.notify();
                        }
                    } else if key.chars().count() == 1 {
                        target.push_str(key);
                        cx.notify();
                    }
                }
            }
        }
    }

    fn perform_login(&mut self, cx: &mut Context<Self>) {
        let username = self.login_username.trim().to_string();
        let password = self.login_password.trim().to_string();
        if username.is_empty() || password.is_empty() {
            self.login_error = Some("请输入账号和密码".to_string());
            cx.notify();
            return;
        }
        self.is_loading = true;
        self.login_error = None;
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
                        this.api.token = Some(token);
                        let is_admin = user.is_admin();
                        let uid_str = user.id.to_string();
                        let display = user.name().to_string();
                        this.current_user = Some(user);
                        this.selected_user_filter = if is_admin {
                            "all".to_string()
                        } else {
                            uid_str
                        };
                        this.active_input = ActiveInput::None;
                        this.show_toast(
                            format!(
                                "欢迎回来，{}（{}）",
                                display,
                                if is_admin { "管理端" } else { "员工端" }
                            ),
                            cx,
                        );
                        this.refresh_all_data(cx);
                    }
                    Err(e) => {
                        this.login_error = Some(format!("{}", e));
                        cx.notify();
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    fn quick_login_as(&mut self, username: &str, password: &str, cx: &mut Context<Self>) {
        self.login_username = username.to_string();
        self.login_password = password.to_string();
        self.perform_login(cx);
    }

    fn refresh_all_data(&mut self, cx: &mut Context<Self>) {
        let Some(user) = self.current_user.clone() else {
            return;
        };
        let api = self.api.clone();
        let start_m = month_key(self.current_year, self.current_month);
        let months = self.month_count.max(1);
        let user_filter = if user.is_admin() {
            self.selected_user_filter.clone()
        } else {
            user.id.to_string()
        };
        let week_monday = self.current_week_monday.clone();
        let is_admin = user.is_admin();

        self.is_loading = true;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let users = if is_admin {
                        api.fetch_users().unwrap_or_default()
                    } else {
                        Vec::new()
                    };
                    let memos = api
                        .fetch_memos(&start_m, months, &user_filter)
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
                this.is_loading = false;
                let (users, memos, reminders, notifications, summaries) = result;
                if !users.is_empty() {
                    this.users = users;
                }
                this.memos = memos;
                this.reminders = reminders;
                this.notifications = notifications;
                if let Some(first_sum) = summaries.first() {
                    this.weekly_goals = first_sum.goals.clone();
                    this.weekly_deliverables = first_sum.deliverables.clone();
                    this.weekly_actual = first_sum.actual.clone();
                    this.weekly_risks = first_sum.risks.clone();
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

    fn navigate_month(&mut self, delta: i32, cx: &mut Context<Self>) {
        let (ny, nm) = shift_month(self.current_year, self.current_month, delta);
        self.current_year = ny;
        self.current_month = nm;
        self.refresh_all_data(cx);
    }

    fn jump_to_today(&mut self, cx: &mut Context<Self>) {
        let (y, m) = current_year_month();
        self.current_year = y;
        self.current_month = m;
        self.refresh_all_data(cx);
    }

    fn start_highlight_sequence(&mut self, memo_ids: Vec<i64>, cx: &mut Context<Self>) {
        if memo_ids.is_empty() {
            return;
        }
        self.active_tab = ActiveTab::Calendar;
        self.highlight_memo_ids = memo_ids;
        self.highlight_index = 0;
        self.focus_current_highlighted_memo(cx);
    }

    fn focus_current_highlighted_memo(&mut self, cx: &mut Context<Self>) {
        let Some(&target_id) = self.highlight_memo_ids.get(self.highlight_index) else {
            return;
        };
        // Find memo date if loaded, and switch month if needed
        if let Some(m) = self.memos.iter().find(|m| m.id == target_id) {
            let parts: Vec<&str> = m.date.split('-').collect();
            if parts.len() >= 2 {
                if let (Ok(y), Ok(mo)) = (parts[0].parse::<i32>(), parts[1].parse::<u32>()) {
                    if y != self.current_year || mo != self.current_month {
                        self.current_year = y;
                        self.current_month = mo;
                        self.refresh_all_data(cx);
                    }
                }
            }
        }
        self.highlight_tick = 12;
        cx.notify();

        cx.spawn(async move |this, cx| {
            for _ in 0..12 {
                cx.background_executor()
                    .timer(Duration::from_millis(220))
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

    fn dismiss_banner_notifications(&mut self, ids: Vec<i64>, cx: &mut Context<Self>) {
        if ids.is_empty() {
            return;
        }
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
                this.show_toast("已标记认可通知为已读", cx);
            })
            .ok();
        })
        .detach();
    }

    fn open_new_memo_editor(&mut self, date_str: &str, cx: &mut Context<Self>) {
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
        self.editor_title.clear();
        self.editor_content.clear();
        self.editor_color = "#3b82f6".to_string();
        self.editor_completed = false;
        self.editor_is_reviewed = false;
        self.editor_is_liked = false;
        self.editor_is_urged = false;
        self.active_input = ActiveInput::EditorTitle;
        cx.notify();
    }

    fn open_existing_memo_editor(&mut self, memo: &Memo, cx: &mut Context<Self>) {
        self.editor_open = true;
        self.editor_memo_id = Some(memo.id);
        self.editor_owner_id = Some(memo.owner_id);
        self.editor_owner_name = if memo.owner_name.is_empty() {
            format!("成员#{}", memo.owner_id)
        } else {
            memo.owner_name.clone()
        };
        self.editor_date = memo.date.clone();
        self.editor_title = memo.title.clone();
        self.editor_content = memo.body_text().to_string();
        self.editor_color = memo.color.clone();
        self.editor_completed = memo.completed;
        self.editor_is_reviewed = memo.is_reviewed;
        self.editor_is_liked = memo.is_liked;
        self.editor_is_urged = memo.is_urged;
        self.active_input = ActiveInput::EditorTitle;
        cx.notify();
    }

    fn save_editor_memo(&mut self, cx: &mut Context<Self>) {
        let title = self.editor_title.trim().to_string();
        if title.is_empty() {
            self.show_toast("请填写工作事项标题", cx);
            return;
        }
        let date = self.editor_date.trim().to_string();
        let content = self.editor_content.trim().to_string();
        let color = self.editor_color.clone();
        let completed = self.editor_completed;
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
                        api.update_memo(
                            id,
                            Some(&title),
                            Some(&content),
                            Some(&color),
                            Some(completed),
                        )
                    } else {
                        api.create_memo(owner_id, &date, &title, &content, &color, completed)
                    }
                })
                .await;

            this.update(cx, |this, cx| match res {
                Ok(_) => {
                    this.show_toast(
                        if memo_id.is_some() {
                            "✅ 事项已保存更新"
                        } else {
                            "✅ 新工作事项已创建"
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
                    this.show_toast("🗑️ 事项已删除", cx);
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
                .spawn(async move { api.update_memo(memo_id, None, None, None, Some(new_completed)) })
                .await;
            this.update(cx, |this, cx| {
                if res.is_ok() {
                    this.show_toast(
                        if new_completed {
                            "✅ 已标记为完成"
                        } else {
                            "⏳ 已恢复为待办"
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

    fn trigger_manager_react(&mut self, memo_id: i64, action: &'static str, cx: &mut Context<Self>) {
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
                                "✓ 已标记「已阅」并通知员工"
                            } else {
                                "已取消「已阅」标记"
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
            let line = format!("• [{}] {}", m.date, m.title);
            if m.completed {
                completed_lines.push(line);
            } else {
                pending_lines.push(line);
            }
        }

        if self.weekly_goals.trim().is_empty() && !week_memos.is_empty() {
            self.weekly_goals = format!("本周计划推进 {} 项核心工作事项", week_memos.len());
        }
        self.weekly_actual = if completed_lines.is_empty() {
            "暂无已完成事项记录".to_string()
        } else {
            completed_lines.join("\n")
        };
        if !pending_lines.is_empty() {
            self.weekly_risks = format!("待跟进结转事项（{} 项）：\n{}", pending_lines.len(), pending_lines.join("\n"));
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
                Ok(_) => this.show_toast("💾 周计划与周报已保存至服务器", cx),
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
                    department: u
                        .department_name
                        .clone()
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
                department: m
                    .department_name
                    .clone()
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
            b.completed
                .cmp(&a.completed)
                .then_with(|| b.rate.cmp(&a.rate))
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

    // ========================================================================
    // UI RENDERERS
    // ========================================================================

    fn render_login_screen(&mut self, palette: ThemePalette, cx: &mut Context<Self>) -> impl IntoElement {
        let is_user_focused = self.active_input == ActiveInput::LoginUsername;
        let is_pass_focused = self.active_input == ActiveInput::LoginPassword;
        let masked_pass = "•".repeat(self.login_password.chars().count());

        div()
            .size_full()
            .bg(palette.bg_app)
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(460.0))
                    .p_6()
                    .rounded_xl()
                    .bg(palette.bg_surface)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .shadow_lg()
                    .flex()
                    .flex_col()
                    .gap_4()
                    // Brand header
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_3()
                                    .child(
                                        div()
                                            .size(px(42.0))
                                            .rounded_lg()
                                            .bg(palette.accent_primary)
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .text_lg()
                                            .text_color(rgb(0xffffff))
                                            .child("📅"),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .child(
                                                div()
                                                    .text_lg()
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(palette.text_primary)
                                                    .child("智能工作日历备忘录"),
                                            )
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .text_color(palette.text_secondary)
                                                    .child("Rust + GPUI 原生桌面客户端 · 管理端 / 员工端双角色"),
                                            ),
                                    ),
                            )
                            .child(
                                div()
                                    .id("login-theme-toggle")
                                    .px_2()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .border_1()
                                    .border_color(palette.border_subtle)
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.theme_mode = match this.theme_mode {
                                            ThemeMode::Light => ThemeMode::Dark,
                                            ThemeMode::Dark => ThemeMode::Light,
                                        };
                                        cx.notify();
                                    }))
                                    .child(match self.theme_mode {
                                        ThemeMode::Light => "🌙 深色",
                                        ThemeMode::Dark => "☀️ 浅色",
                                    }),
                            ),
                    )
                    // Quick Role Presets
                    .child(
                        div()
                            .p_3()
                            .rounded_lg()
                            .bg(palette.bg_surface_alt)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight:: MEDIUM)
                                    .text_color(palette.text_secondary)
                                    .child("⚡ 一键快速体验（直连生产服务器 45.205.25.3:8090）："),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .gap_2()
                                    .child(
                                        div()
                                            .id("quick-login-admin")
                                            .px_3()
                                            .py_1()
                                            .rounded_md()
                                            .bg(palette.accent_primary)
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(rgb(0xffffff))
                                            .cursor_pointer()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.quick_login_as("admin", "0000", cx);
                                            }))
                                            .child("👑 管理端登录 (admin)"),
                                    )
                                    .child(
                                        div()
                                            .id("quick-login-emp1")
                                            .px_3()
                                            .py_1()
                                            .rounded_md()
                                            .bg(palette.accent_emerald)
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(rgb(0xffffff))
                                            .cursor_pointer()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.quick_login_as("杨振", "0000", cx);
                                            }))
                                            .child("🧑‍💻 员工端 · 杨振"),
                                    )
                                    .child(
                                        div()
                                            .id("quick-login-emp2")
                                            .px_3()
                                            .py_1()
                                            .rounded_md()
                                            .bg(palette.bg_surface)
                                            .border_1()
                                            .border_color(palette.border_strong)
                                            .text_xs()
                                            .text_color(palette.text_primary)
                                            .cursor_pointer()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.quick_login_as("罗文", "0000", cx);
                                            }))
                                            .child("🧑‍💻 员工端 · 罗文"),
                                    )
                                    .child(
                                        div()
                                            .id("quick-login-emp3")
                                            .px_3()
                                            .py_1()
                                            .rounded_md()
                                            .bg(palette.bg_surface)
                                            .border_1()
                                            .border_color(palette.border_strong)
                                            .text_xs()
                                            .text_color(palette.text_primary)
                                            .cursor_pointer()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.quick_login_as("周工", "0000", cx);
                                            }))
                                            .child("🧑‍💻 员工端 · 周工"),
                                    ),
                            ),
                    )
                    // Username Input
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child("登录账号（点击输入框后可直接键盘输入）"),
                            )
                            .child(
                                div()
                                    .id("login-username-box")
                                    .h(px(38.0))
                                    .px_3()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if is_user_focused {
                                        palette.accent_primary
                                    } else {
                                        palette.border_subtle
                                    })
                                    .flex()
                                    .items_center()
                                    .text_sm()
                                    .text_color(palette.text_primary)
                                    .cursor_text()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_input = ActiveInput::LoginUsername;
                                        cx.notify();
                                    }))
                                    .child(if self.login_username.is_empty() {
                                        "请输入用户名 (如 admin)...".to_string()
                                    } else if is_user_focused {
                                        format!("{}|", self.login_username)
                                    } else {
                                        self.login_username.clone()
                                    }),
                            ),
                    )
                    // Password Input
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child("登录密码"),
                            )
                            .child(
                                div()
                                    .id("login-password-box")
                                    .h(px(38.0))
                                    .px_3()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if is_pass_focused {
                                        palette.accent_primary
                                    } else {
                                        palette.border_subtle
                                    })
                                    .flex()
                                    .items_center()
                                    .text_sm()
                                    .text_color(palette.text_primary)
                                    .cursor_text()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_input = ActiveInput::LoginPassword;
                                        cx.notify();
                                    }))
                                    .child(if self.login_password.is_empty() {
                                        "请输入密码...".to_string()
                                    } else if is_pass_focused {
                                        format!("{}|", masked_pass)
                                    } else {
                                        masked_pass
                                    }),
                            ),
                    )
                    // Error message if any
                    .when_some(self.login_error.clone(), |el, err| {
                        el.child(
                            div()
                                .p_2()
                                .rounded_md()
                                .bg(palette.accent_rose_bg)
                                .text_xs()
                                .text_color(palette.accent_rose)
                                .child(format!("⚠️ {}", err)),
                        )
                    })
                    // Submit Button
                    .child(
                        div()
                            .id("login-submit-btn")
                            .h(px(40.0))
                            .rounded_md()
                            .bg(palette.accent_primary)
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_sm()
                            .font_weight(gpui::FontWeight::BOLD)
                            .text_color(rgb(0xffffff))
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.perform_login(cx);
                            }))
                            .child(if self.is_loading {
                                "正在连接服务器登录..."
                            } else {
                                "立即登录系统 →"
                            }),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(palette.text_muted)
                            .child(format!("后端接口地址: {}", self.api.base_url)),
                    ),
            )
    }

    fn render_sidebar(
        &mut self,
        user: &User,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let is_admin = user.is_admin();
        let reminder_count = self.reminders.iter().filter(|m| !m.completed).count();

        if self.sidebar_collapsed {
            return div()
                .w(px(56.0))
                .h_full()
                .bg(palette.bg_sidebar)
                .border_r_1()
                .border_color(palette.border_subtle)
                .flex()
                .flex_col()
                .items_center()
                .py_3()
                .gap_3()
                .child(
                    div()
                        .id("sidebar-expand-btn")
                        .size(px(36.0))
                        .rounded_md()
                        .bg(palette.accent_primary)
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(rgb(0xffffff))
                        .cursor_pointer()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.sidebar_collapsed = false;
                            cx.notify();
                        }))
                        .child("☰"),
                )
                .child(
                    div()
                        .id("nav-col-cal")
                        .size(px(36.0))
                        .rounded_md()
                        .bg(if self.active_tab == ActiveTab::Calendar {
                            palette.accent_primary_bg
                        } else {
                            palette.bg_surface_alt
                        })
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.active_tab = ActiveTab::Calendar;
                            cx.notify();
                        }))
                        .child("📅"),
                )
                .child(
                    div()
                        .id("nav-col-week")
                        .size(px(36.0))
                        .rounded_md()
                        .bg(if self.active_tab == ActiveTab::WeeklyPlan {
                            palette.accent_primary_bg
                        } else {
                            palette.bg_surface_alt
                        })
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.active_tab = ActiveTab::WeeklyPlan;
                            cx.notify();
                        }))
                        .child("📋"),
                )
                .child(
                    div()
                        .id("nav-col-dash")
                        .size(px(36.0))
                        .rounded_md()
                        .bg(if self.active_tab == ActiveTab::Dashboard {
                            palette.accent_primary_bg
                        } else {
                            palette.bg_surface_alt
                        })
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.active_tab = ActiveTab::Dashboard;
                            cx.notify();
                        }))
                        .child("📊"),
                );
        }

        div()
            .w(px(230.0))
            .h_full()
            .bg(palette.bg_sidebar)
            .border_r_1()
            .border_color(palette.border_subtle)
            .flex()
            .flex_col()
            .justify_between()
            .p_3()
            // Top section: brand + role badge + nav
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(
                                        div()
                                            .size(px(32.0))
                                            .rounded_md()
                                            .bg(if is_admin {
                                                palette.accent_primary
                                            } else {
                                                palette.accent_emerald
                                            })
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .text_sm()
                                            .text_color(rgb(0xffffff))
                                            .child(if is_admin { "👑" } else { "📅" }),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .child(
                                                div()
                                                    .text_sm()
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(palette.text_primary)
                                                    .child("智能工作日历"),
                                            )
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .text_color(if is_admin {
                                                        palette.accent_primary
                                                    } else {
                                                        palette.accent_emerald
                                                    })
                                                    .child(if is_admin {
                                                        "管理端 · 全局督办视图"
                                                    } else {
                                                        "员工端 · 一屏工作台"
                                                    }),
                                            ),
                                    ),
                            )
                            .child(
                                div()
                                    .id("sidebar-collapse-btn")
                                    .px_2()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.sidebar_collapsed = true;
                                        cx.notify();
                                    }))
                                    .child("◀"),
                            ),
                    )
                    // Navigation items
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .id("nav-tab-calendar")
                                    .px_3()
                                    .py_2()
                                    .rounded_md()
                                    .bg(if self.active_tab == ActiveTab::Calendar {
                                        palette.accent_primary_bg
                                    } else {
                                        rgba(0x00000000)
                                    })
                                    .text_sm()
                                    .font_weight(if self.active_tab == ActiveTab::Calendar {
                                        gpui::FontWeight::BOLD
                                    } else {
                                        gpui::FontWeight::NORMAL
                                    })
                                    .text_color(if self.active_tab == ActiveTab::Calendar {
                                        palette.accent_primary
                                    } else {
                                        palette.text_primary
                                    })
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_tab = ActiveTab::Calendar;
                                        cx.notify();
                                    }))
                                    .child("📅 工作日历视图"),
                            )
                            .child(
                                div()
                                    .id("nav-tab-weekly")
                                    .px_3()
                                    .py_2()
                                    .rounded_md()
                                    .bg(if self.active_tab == ActiveTab::WeeklyPlan {
                                        palette.accent_primary_bg
                                    } else {
                                        rgba(0x00000000)
                                    })
                                    .text_sm()
                                    .font_weight(if self.active_tab == ActiveTab::WeeklyPlan {
                                        gpui::FontWeight::BOLD
                                    } else {
                                        gpui::FontWeight::NORMAL
                                    })
                                    .text_color(if self.active_tab == ActiveTab::WeeklyPlan {
                                        palette.accent_primary
                                    } else {
                                        palette.text_primary
                                    })
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_tab = ActiveTab::WeeklyPlan;
                                        cx.notify();
                                    }))
                                    .child("📋 周计划与周报"),
                            )
                            .child(
                                div()
                                    .id("nav-tab-dashboard")
                                    .px_3()
                                    .py_2()
                                    .rounded_md()
                                    .bg(if self.active_tab == ActiveTab::Dashboard {
                                        palette.accent_primary_bg
                                    } else {
                                        rgba(0x00000000)
                                    })
                                    .text_sm()
                                    .font_weight(if self.active_tab == ActiveTab::Dashboard {
                                        gpui::FontWeight::BOLD
                                    } else {
                                        gpui::FontWeight::NORMAL
                                    })
                                    .text_color(if self.active_tab == ActiveTab::Dashboard {
                                        palette.accent_primary
                                    } else {
                                        palette.text_primary
                                    })
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_tab = ActiveTab::Dashboard;
                                        cx.notify();
                                    }))
                                    .child("📊 研发效能看板"),
                            )
                            .child(
                                div()
                                    .id("nav-tab-reminders")
                                    .px_3()
                                    .py_2()
                                    .rounded_md()
                                    .bg(if reminder_count > 0 {
                                        palette.accent_amber_bg
                                    } else {
                                        rgba(0x00000000)
                                    })
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .text_sm()
                                    .text_color(palette.text_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.reminder_modal_open = true;
                                        cx.notify();
                                    }))
                                    .child("🔔 待办事项提醒")
                                    .child(
                                        div()
                                            .px_2()
                                            .py(px(1.0))
                                            .rounded_full()
                                            .bg(if reminder_count > 0 {
                                                palette.accent_rose
                                            } else {
                                                palette.border_strong
                                            })
                                            .text_xs()
                                            .text_color(rgb(0xffffff))
                                            .child(format!("{}", reminder_count)),
                                    ),
                            ),
                    )
                    // Manager Quick Member Filter in Sidebar
                    .when(is_admin && !self.users.is_empty(), |el| {
                        let sel = self.selected_user_filter.clone();
                        let emp_users: Vec<User> = self
                            .users
                            .iter()
                            .filter(|u| !u.is_admin())
                            .cloned()
                            .collect();
                        el.child(
                            div()
                                .mt_2()
                                .pt_2()
                                .border_t_1()
                                .border_color(palette.border_subtle)
                                .flex()
                                .flex_col()
                                .gap_1()
                                .child(
                                    div()
                                        .text_xs()
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .text_color(palette.text_secondary)
                                        .child("👥 团队成员筛选"),
                                )
                                .child(
                                    div()
                                        .id("sidebar-member-list")
                                        .max_h(px(210.0))
                                        .overflow_y_scroll()
                                        .flex()
                                        .flex_col()
                                        .gap_1()
                                        .child(
                                            div()
                                                .id("filter-member-all")
                                                .px_2()
                                                .py_1()
                                                .rounded_md()
                                                .bg(if sel == "all" {
                                                    palette.accent_primary
                                                } else {
                                                    palette.bg_surface_alt
                                                })
                                                .text_xs()
                                                .text_color(if sel == "all" {
                                                    rgb(0xffffff)
                                                } else {
                                                    palette.text_primary
                                                })
                                                .cursor_pointer()
                                                .on_click(cx.listener(|this, _, _, cx| {
                                                    this.selected_user_filter = "all".to_string();
                                                    this.refresh_all_data(cx);
                                                }))
                                                .child("🌐 全部团队成员"),
                                        )
                                        .children(emp_users.into_iter().map(|u| {
                                            let uid_str = u.id.to_string();
                                            let is_active = sel == uid_str;
                                            let label = format!(
                                                "👤 {} ({})",
                                                u.name(),
                                                u.department_name
                                                    .as_deref()
                                                    .unwrap_or("研发")
                                            );
                                            div()
                                                .id(SharedString::from(format!(
                                                    "sidebar-emp-{}",
                                                    u.id
                                                )))
                                                .px_2()
                                                .py_1()
                                                .rounded_md()
                                                .bg(if is_active {
                                                    palette.accent_primary
                                                } else {
                                                    palette.bg_surface_alt
                                                })
                                                .text_xs()
                                                .text_color(if is_active {
                                                    rgb(0xffffff)
                                                } else {
                                                    palette.text_primary
                                                })
                                                .cursor_pointer()
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.selected_user_filter = uid_str.clone();
                                                    this.refresh_all_data(cx);
                                                }))
                                                .child(label)
                                        })),
                                ),
                        )
                    }),
            )
            // Bottom section: Role switcher + Theme toggle + User card
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .pt_2()
                    .border_t_1()
                    .border_color(palette.border_subtle)
                    // Instant Role Switcher for testing Manager vs Employee View
                    .child(
                        div()
                            .flex()
                            .gap_1()
                            .child(
                                div()
                                    .id("switch-to-admin-btn")
                                    .flex_1()
                                    .py_1()
                                    .rounded_md()
                                    .bg(if is_admin {
                                        palette.accent_primary
                                    } else {
                                        palette.bg_surface_alt
                                    })
                                    .text_xs()
                                    .text_color(if is_admin {
                                        rgb(0xffffff)
                                    } else {
                                        palette.text_secondary
                                    })
                                    .flex()
                                    .justify_center()
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.quick_login_as("admin", "0000", cx);
                                    }))
                                    .child("👑 管理端"),
                            )
                            .child(
                                div()
                                    .id("switch-to-emp-btn")
                                    .flex_1()
                                    .py_1()
                                    .rounded_md()
                                    .bg(if !is_admin {
                                        palette.accent_emerald
                                    } else {
                                        palette.bg_surface_alt
                                    })
                                    .text_xs()
                                    .text_color(if !is_admin {
                                        rgb(0xffffff)
                                    } else {
                                        palette.text_secondary
                                    })
                                    .flex()
                                    .justify_center()
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.quick_login_as("杨振", "0000", cx);
                                    }))
                                    .child("🧑‍💻 员工端"),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_1()
                            .child(
                                div()
                                    .id("sidebar-theme-btn")
                                    .flex_1()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .border_1()
                                    .border_color(palette.border_subtle)
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .flex()
                                    .justify_center()
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.theme_mode = match this.theme_mode {
                                            ThemeMode::Light => ThemeMode::Dark,
                                            ThemeMode::Dark => ThemeMode::Light,
                                        };
                                        cx.notify();
                                    }))
                                    .child(match self.theme_mode {
                                        ThemeMode::Light => "🌙 深色主题",
                                        ThemeMode::Dark => "☀️ 浅色主题",
                                    }),
                            )
                            .child(
                                div()
                                    .id("sidebar-logout-btn")
                                    .px_2()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.accent_rose_bg)
                                    .text_xs()
                                    .text_color(palette.accent_rose)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.current_user = None;
                                        this.api.token = None;
                                        this.highlight_memo_ids.clear();
                                        cx.notify();
                                    }))
                                    .child("退出"),
                            ),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(palette.text_muted)
                            .child(format!("当前账号: {} ({})", user.name(), user.username)),
                    ),
            )
    }

    fn render_top_header(
        &mut self,
        user: &User,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let is_admin = user.is_admin();
        let search_focused = self.active_input == ActiveInput::SearchQuery;
        let today = today_date_str();

        div()
            .h(px(48.0))
            .w_full()
            .px_4()
            .bg(palette.bg_surface)
            .border_b_1()
            .border_color(palette.border_subtle)
            .flex()
            .items_center()
            .justify_between()
            // Left: Role indicator & Search box
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(
                        div()
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .bg(if is_admin {
                                palette.accent_primary_bg
                            } else {
                                palette.accent_emerald_bg
                            })
                            .text_xs()
                            .font_weight(gpui::FontWeight::BOLD)
                            .text_color(if is_admin {
                                palette.accent_primary
                            } else {
                                palette.accent_emerald
                            })
                            .child(if is_admin {
                                "👑 管理端 · 大卡片全局督办"
                            } else {
                                "🧑‍💻 员工端 · 一屏免滚动视图"
                            }),
                    )
                    // Search bar
                    .child(
                        div()
                            .id("top-search-input")
                            .w(px(220.0))
                            .h(px(30.0))
                            .px_2()
                            .rounded_md()
                            .bg(palette.bg_surface_alt)
                            .border_1()
                            .border_color(if search_focused {
                                palette.accent_primary
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .items_center()
                            .justify_between()
                            .text_xs()
                            .text_color(if self.search_query.is_empty() {
                                palette.text_muted
                            } else {
                                palette.text_primary
                            })
                            .cursor_text()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_input = ActiveInput::SearchQuery;
                                cx.notify();
                            }))
                            .child(if self.search_query.is_empty() {
                                if search_focused {
                                    "🔍 输入关键词筛选...|".to_string()
                                } else {
                                    "🔍 搜索事项标题/内容/成员...".to_string()
                                }
                            } else if search_focused {
                                format!("🔍 {}|", self.search_query)
                            } else {
                                format!("🔍 {}", self.search_query)
                            })
                            .when(!self.search_query.is_empty(), |el| {
                                el.child(
                                    div()
                                        .id("clear-search-btn")
                                        .px_1()
                                        .text_xs()
                                        .text_color(palette.text_secondary)
                                        .cursor_pointer()
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.search_query.clear();
                                            cx.notify();
                                        }))
                                        .child("✕"),
                                )
                            }),
                    ),
            )
            // Right: Month count switcher + Refresh + New Memo
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div()
                            .flex()
                            .rounded_md()
                            .bg(palette.bg_surface_alt)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .p(px(2.0))
                            .child(
                                div()
                                    .id("month-count-1")
                                    .px_2()
                                    .py(px(2.0))
                                    .rounded_sm()
                                    .bg(if self.month_count == 1 {
                                        palette.accent_primary
                                    } else {
                                        rgba(0x00000000)
                                    })
                                    .text_xs()
                                    .text_color(if self.month_count == 1 {
                                        rgb(0xffffff)
                                    } else {
                                        palette.text_secondary
                                    })
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.month_count = 1;
                                        this.refresh_all_data(cx);
                                    }))
                                    .child("单月视图"),
                            )
                            .child(
                                div()
                                    .id("month-count-2")
                                    .px_2()
                                    .py(px(2.0))
                                    .rounded_sm()
                                    .bg(if self.month_count == 2 {
                                        palette.accent_primary
                                    } else {
                                        rgba(0x00000000)
                                    })
                                    .text_xs()
                                    .text_color(if self.month_count == 2 {
                                        rgb(0xffffff)
                                    } else {
                                        palette.text_secondary
                                    })
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.month_count = 2;
                                        this.refresh_all_data(cx);
                                    }))
                                    .child("双月联排"),
                            ),
                    )
                    .child(
                        div()
                            .id("top-refresh-btn")
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .bg(palette.bg_surface_alt)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .text_xs()
                            .text_color(palette.text_primary)
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.refresh_all_data(cx);
                                this.show_toast("🔄 已同步最新云端数据", cx);
                            }))
                            .child(if self.is_loading { "⏳ 同步中" } else { "🔄 刷新" }),
                    )
                    .child(
                        div()
                            .id("top-new-memo-btn")
                            .px_3()
                            .py_1()
                            .rounded_md()
                            .bg(palette.accent_primary)
                            .text_xs()
                            .font_weight(gpui::FontWeight::BOLD)
                            .text_color(rgb(0xffffff))
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.open_new_memo_editor(&today, cx);
                            }))
                            .child("＋ 新建工作事项"),
                    ),
            )
    }

    /// Employee top praise / urge notification banner (closed-loop calendar定位)
    fn render_top_notification_banners(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let unread_praise: Vec<NotificationItem> = self
            .notifications
            .iter()
            .filter(|n| !n.is_read && (n.notif_type == "review" || n.notif_type == "like"))
            .cloned()
            .collect();

        let unread_urge: Vec<NotificationItem> = self
            .notifications
            .iter()
            .filter(|n| !n.is_read && n.notif_type == "urge")
            .cloned()
            .collect();

        let mut container = div().flex().flex_col().gap_1().px_4();

        if !unread_praise.is_empty() {
            let review_cnt = unread_praise
                .iter()
                .filter(|n| n.notif_type == "review")
                .count();
            let like_cnt = unread_praise
                .iter()
                .filter(|n| n.notif_type == "like")
                .count();
            let praise_ids: Vec<i64> = unread_praise.iter().map(|n| n.id).collect();
            let memo_ids: Vec<i64> = unread_praise
                .iter()
                .filter_map(|n| n.memo_id)
                .collect();
            let preview_titles: Vec<String> = unread_praise
                .iter()
                .take(2)
                .map(|n| format!("「{}」", n.title))
                .collect();

            container = container.child(
                div()
                    .mt_2()
                    .px_3()
                    .py_2()
                    .rounded_lg()
                    .bg(palette.accent_emerald_bg)
                    .border_1()
                    .border_color(palette.accent_emerald)
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .id("praise-banner-locate")
                            .flex_1()
                            .flex()
                            .items_center()
                            .gap_2()
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.start_highlight_sequence(memo_ids.clone(), cx);
                            }))
                            .child(
                                div()
                                    .px_2()
                                    .py(px(2.0))
                                    .rounded_md()
                                    .bg(palette.accent_emerald)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .child("👏 收到管理端认可"),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .text_color(palette.text_primary)
                                    .child(format!(
                                        "共 {} 条已阅、{} 条点赞 {} — 点击自动跳转日历并高亮闪烁定位 ✨",
                                        review_cnt,
                                        like_cnt,
                                        preview_titles.join(" ")
                                    )),
                            ),
                    )
                    .child(
                        div()
                            .id("praise-banner-dismiss")
                            .px_2()
                            .py(px(2.0))
                            .rounded_md()
                            .bg(palette.bg_surface)
                            .text_xs()
                            .text_color(palette.text_secondary)
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.dismiss_banner_notifications(praise_ids.clone(), cx);
                            }))
                            .child("✕ 知道了"),
                    ),
            );
        }

        if !unread_urge.is_empty() {
            let urge_ids: Vec<i64> = unread_urge.iter().map(|n| n.id).collect();
            let urge_memo_ids: Vec<i64> = unread_urge.iter().filter_map(|n| n.memo_id).collect();
            let preview: Vec<String> = unread_urge
                .iter()
                .take(2)
                .map(|n| format!("「{}」", n.title))
                .collect();

            container = container.child(
                div()
                    .mt_2()
                    .px_3()
                    .py_2()
                    .rounded_lg()
                    .bg(palette.accent_rose_bg)
                    .border_1()
                    .border_color(palette.accent_rose)
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .id("urge-banner-locate")
                            .flex_1()
                            .flex()
                            .items_center()
                            .gap_2()
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.start_highlight_sequence(urge_memo_ids.clone(), cx);
                            }))
                            .child(
                                div()
                                    .px_2()
                                    .py(px(2.0))
                                    .rounded_md()
                                    .bg(palette.accent_rose)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .child(format!("⚡ 督办催办 ({}条)", unread_urge.len())),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .child(format!(
                                        "{} — 点击在日历中高亮定位",
                                        preview.join(" ")
                                    )),
                            ),
                    )
                    .child(
                        div()
                            .id("urge-banner-dismiss")
                            .px_2()
                            .py(px(2.0))
                            .rounded_md()
                            .bg(palette.bg_surface)
                            .text_xs()
                            .text_color(palette.text_secondary)
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.dismiss_banner_notifications(urge_ids.clone(), cx);
                            }))
                            .child("✕ 已读"),
                    ),
            );
        }

        container
    }

    /// Manager Team Leaderboard (Collapsible Podium)
    fn render_manager_leaderboard(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let stats = self.compute_leaderboard();
        let display_count = if self.leaderboard_expanded {
            stats.len()
        } else {
            stats.len().min(4)
        };
        let shown_stats: Vec<(usize, MemberStat)> =
            stats.into_iter().enumerate().take(display_count).collect();
        let current_filter = self.selected_user_filter.clone();

        div()
            .mx_4()
            .mt_2()
            .p_3()
            .rounded_xl()
            .bg(palette.bg_surface)
            .border_1()
            .border_color(palette.border_subtle)
            .flex()
            .flex_col()
            .gap_2()
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.text_primary)
                                    .child("🏆 团队执行力风云榜（点击成员卡片可筛选日历）"),
                            )
                            .when(current_filter != "all", |el| {
                                el.child(
                                    div()
                                        .id("leaderboard-reset-filter")
                                        .px_2()
                                        .py(px(1.0))
                                        .rounded_md()
                                        .bg(palette.accent_primary_bg)
                                        .text_xs()
                                        .text_color(palette.accent_primary)
                                        .cursor_pointer()
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.selected_user_filter = "all".to_string();
                                            this.refresh_all_data(cx);
                                        }))
                                        .child("✕ 恢复显示全部成员"),
                                )
                            }),
                    )
                    .child(
                        div()
                            .id("leaderboard-toggle-expand")
                            .px_2()
                            .py(px(2.0))
                            .rounded_md()
                            .bg(palette.bg_surface_alt)
                            .text_xs()
                            .text_color(palette.text_secondary)
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.leaderboard_expanded = !this.leaderboard_expanded;
                                cx.notify();
                            }))
                            .child(if self.leaderboard_expanded {
                                "▲ 收起榜单"
                            } else {
                                "▼ 展开全部排名"
                            }),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .children(shown_stats.into_iter().map(|(idx, st)| {
                        let uid_str = st.user_id.to_string();
                        let is_selected = current_filter == uid_str;
                        let medal = match idx {
                            0 => "🥇",
                            1 => "🥈",
                            2 => "🥉",
                            _ => "🏅",
                        };
                        div()
                            .id(SharedString::from(format!("podium-card-{}", st.user_id)))
                            .w(px(215.0))
                            .p_2()
                            .rounded_lg()
                            .bg(if is_selected {
                                palette.accent_primary_bg
                            } else {
                                palette.bg_surface_alt
                            })
                            .border_1()
                            .border_color(if is_selected {
                                palette.accent_primary
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .items_center()
                            .justify_between()
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if this.selected_user_filter == uid_str {
                                    this.selected_user_filter = "all".to_string();
                                } else {
                                    this.selected_user_filter = uid_str.clone();
                                }
                                this.refresh_all_data(cx);
                            }))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(div().text_base().child(medal))
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(palette.text_primary)
                                                    .child(format!("{} · {}", st.name, st.department)),
                                            )
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .text_color(palette.text_secondary)
                                                    .child(format!(
                                                        "完成 {}/{} · 👍{} ✓{}",
                                                        st.completed, st.total, st.liked, st.reviewed
                                                    )),
                                            ),
                                    ),
                            )
                            .child(
                                div()
                                    .px_2()
                                    .py(px(2.0))
                                    .rounded_md()
                                    .bg(palette.accent_emerald_bg)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_emerald)
                                    .child(format!("{}%", st.rate)),
                            )
                    })),
            )
    }

    /// Renders a single month card:
    /// - Employee View (`!is_admin`): 100% single-screen adaptive height (`flex_1`, no vertical scroll, 5 rows when <= 35 cells)
    /// - Manager View (`is_admin`): Large day cells (`min_h(px(160.0))`) in a scrollable container
    /// - Month Header has `< 2026年9月 > 今天` centered in the top middle!
    fn render_month_card(
        &mut self,
        year: i32,
        month: u32,
        is_admin: bool,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let today = today_date_str();
        let cells = build_month_cells(year, month, &today);
        let row_count = cells.len() / 7;
        let m_prefix = month_key(year, month);
        let month_memos_count = self
            .memos
            .iter()
            .filter(|m| m.date.starts_with(&m_prefix))
            .count();
        let month_done_count = self
            .memos
            .iter()
            .filter(|m| m.date.starts_with(&m_prefix) && m.completed)
            .count();

        let active_highlight_id = self
            .highlight_memo_ids
            .get(self.highlight_index)
            .copied()
            .filter(|_| self.highlight_tick > 0);
        let pulse_bright = self.highlight_tick % 2 == 1;

        let weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

        // Build rows of 7 cells
        let mut week_rows = Vec::with_capacity(row_count);
        for r in 0..row_count {
            let row_slice = &cells[r * 7..(r + 1) * 7];
            let mut row_div = div().w_full().flex().gap_1();
            if is_admin {
                row_div = row_div.min_h(px(165.0));
            } else {
                // Employee view: adaptive single-screen row height!
                row_div = row_div.flex_1().min_h(px(0.0));
            }

            for cell in row_slice.iter().cloned() {
                let day_memos = self.filtered_memos_for_date(&cell.date_str);
                let has_highlighted_memo = active_highlight_id
                    .map(|hid| day_memos.iter().any(|m| m.id == hid))
                    .unwrap_or(false);

                let cell_bg = if has_highlighted_memo {
                    if pulse_bright {
                        palette.accent_emerald_bg
                    } else {
                        palette.bg_cell_today
                    }
                } else if cell.is_today {
                    palette.bg_cell_today
                } else if cell.is_current_month {
                    palette.bg_cell
                } else {
                    palette.bg_cell_other
                };

                let cell_border = if has_highlighted_memo {
                    if pulse_bright {
                        palette.accent_emerald
                    } else {
                        palette.accent_amber
                    }
                } else if cell.is_today {
                    palette.accent_primary
                } else {
                    palette.border_subtle
                };

                let max_visible = if is_admin { 6 } else { 3 };
                let total_day_memos = day_memos.len();
                let visible_memos: Vec<Memo> = day_memos.into_iter().take(max_visible).collect();
                let hidden_count = total_day_memos.saturating_sub(max_visible);
                let cell_date_for_add = cell.date_str.clone();

                let mut cell_el = div()
                    .id(SharedString::from(format!("cell-{}-{}-{}", year, month, cell.date_str)))
                    .flex_1()
                    .h_full()
                    .p_1()
                    .rounded_lg()
                    .bg(cell_bg)
                    .border_color(cell_border)
                    .flex()
                    .flex_col()
                    .gap_1()
                    .overflow_hidden();

                if has_highlighted_memo || cell.is_today {
                    cell_el = cell_el.border_2();
                } else {
                    cell_el = cell_el.border_1();
                }

                // Cell top header: day number + today/highlight badge + quick '+' button
                cell_el = cell_el.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .px_1()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_1()
                                .child(
                                    div()
                                        .text_xs()
                                        .font_weight(if cell.is_today || cell.is_current_month {
                                            gpui::FontWeight::BOLD
                                        } else {
                                            gpui::FontWeight::NORMAL
                                        })
                                        .text_color(if cell.is_today {
                                            palette.accent_primary
                                        } else if cell.is_current_month {
                                            palette.text_primary
                                        } else {
                                            palette.text_muted
                                        })
                                        .child(format!("{}", cell.day_num)),
                                )
                                .when(cell.is_today, |el| {
                                    el.child(
                                        div()
                                            .px_1()
                                            .rounded_sm()
                                            .bg(palette.accent_primary)
                                            .text_xs()
                                            .text_color(rgb(0xffffff))
                                            .child("今"),
                                    )
                                })
                                .when(has_highlighted_memo, |el| {
                                    el.child(
                                        div()
                                            .px_1()
                                            .rounded_sm()
                                            .bg(palette.accent_emerald)
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(rgb(0xffffff))
                                            .child("✨定位中"),
                                    )
                                }),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("add-btn-{}", cell.date_str)))
                                .px_1()
                                .rounded_sm()
                                .bg(palette.bg_surface_alt)
                                .text_xs()
                                .text_color(palette.text_secondary)
                                .cursor_pointer()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.open_new_memo_editor(&cell_date_for_add, cx);
                                }))
                                .child("＋"),
                        ),
                );

                // Memo items list inside cell
                let mut list_container = div().flex_1().flex().flex_col().gap_1().overflow_hidden();

                for memo in visible_memos {
                    let is_this_highlighted = active_highlight_id == Some(memo.id);
                    let dot_color = parse_hex_color(&memo.color);
                    let memo_for_edit = memo.clone();
                    let memo_for_carry = memo.clone();
                    let memo_id = memo.id;
                    let is_done = memo.completed;

                    let pill_bg = if is_this_highlighted {
                        if pulse_bright {
                            palette.accent_emerald_bg
                        } else {
                            palette.accent_amber_bg
                        }
                    } else if memo.is_urged && !memo.completed {
                        palette.accent_rose_bg
                    } else {
                        palette.bg_surface_alt
                    };

                    let pill_border = if is_this_highlighted {
                        if pulse_bright {
                            palette.accent_emerald
                        } else {
                            palette.accent_amber
                        }
                    } else if memo.is_urged && !memo.completed {
                        palette.accent_rose
                    } else {
                        palette.border_subtle
                    };

                    let mut pill = div()
                        .id(SharedString::from(format!("memo-pill-{}", memo.id)))
                        .w_full()
                        .px_1()
                        .py(px(2.0))
                        .rounded_md()
                        .bg(pill_bg)
                        .border_color(pill_border)
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap_1()
                        .cursor_pointer()
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.open_existing_memo_editor(&memo_for_edit, cx);
                        }));

                    if is_this_highlighted {
                        pill = pill.border_2();
                    } else {
                        pill = pill.border_1();
                    }

                    // Left side of memo pill: checkbox + owner tag (if admin) + title
                    pill = pill.child(
                        div()
                            .flex_1()
                            .flex()
                            .items_center()
                            .gap_1()
                            .overflow_hidden()
                            .child(
                                div()
                                    .id(SharedString::from(format!("chk-{}", memo.id)))
                                    .size(px(13.0))
                                    .rounded_sm()
                                    .bg(if is_done {
                                        palette.accent_emerald
                                    } else {
                                         dot_color
                                    })
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_xs()
                                    .text_color(rgb(0xffffff))
                                    .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                        cx.stop_propagation();
                                    })
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.toggle_memo_completed(memo_id, !is_done, cx);
                                    }))
                                    .child(if is_done { "✓" } else { "" }),
                            )
                            .when(is_admin && !memo.owner_name.is_empty(), |el| {
                                el.child(
                                    div()
                                        .px_1()
                                        .rounded_sm()
                                        .bg(palette.accent_primary_bg)
                                        .text_xs()
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .text_color(palette.accent_primary)
                                        .child(memo.owner_name.clone()),
                                )
                            })
                            .child(
                                div()
                                    .flex_1()
                                    .overflow_hidden()
                                    .text_xs()
                                    .text_color(if is_done {
                                        palette.text_muted
                                    } else {
                                        palette.text_primary
                                    })
                                    .child(memo.title.clone()),
                            ),
                    );

                    // Right side of memo pill: stamps + quick action (↪ next day or manager ✓/👍)
                    pill = pill.child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .when(memo.is_reviewed, |el| {
                                el.child(
                                    div()
                                        .px_1()
                                        .rounded_sm()
                                        .bg(palette.accent_emerald_bg)
                                        .text_xs()
                                        .text_color(palette.accent_emerald)
                                        .child("✓阅"),
                                )
                            })
                            .when(memo.is_liked, |el| {
                                el.child(
                                    div()
                                        .px_1()
                                        .rounded_sm()
                                        .bg(palette.accent_amber_bg)
                                        .text_xs()
                                        .text_color(palette.accent_amber)
                                        .child("👍"),
                                )
                            })
                            .when(is_admin, |el| {
                                el.child(
                                    div()
                                        .id(SharedString::from(format!("mgr-like-{}", memo.id)))
                                        .px_1()
                                        .rounded_sm()
                                        .bg(palette.bg_surface)
                                        .text_xs()
                                        .text_color(palette.text_secondary)
                                        .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                            cx.stop_propagation();
                                        })
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.trigger_manager_react(memo_id, "like", cx);
                                        }))
                                        .child("👍"),
                                )
                                .child(
                                    div()
                                        .id(SharedString::from(format!("mgr-rev-{}", memo.id)))
                                        .px_1()
                                        .rounded_sm()
                                        .bg(palette.bg_surface)
                                        .text_xs()
                                        .text_color(palette.text_secondary)
                                        .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                            cx.stop_propagation();
                                        })
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.trigger_manager_react(memo_id, "review", cx);
                                        }))
                                        .child("阅"),
                                )
                            })
                            .when(!is_admin && !is_done, |el| {
                                el.child(
                                    div()
                                        .id(SharedString::from(format!("carry-{}", memo.id)))
                                        .px_1()
                                        .rounded_sm()
                                        .bg(palette.accent_primary_bg)
                                        .text_xs()
                                        .text_color(palette.accent_primary)
                                        .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                            cx.stop_propagation();
                                        })
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.trigger_carryover(memo_for_carry.clone(), cx);
                                        }))
                                        .child("↪"),
                                )
                            }),
                    );

                    list_container = list_container.child(pill);
                }

                if hidden_count > 0 {
                    let date_for_more = cell.date_str.clone();
                    list_container = list_container.child(
                        div()
                            .id(SharedString::from(format!("more-{}", date_for_more)))
                            .px_1()
                            .text_xs()
                            .text_color(palette.accent_primary)
                            .child(format!("+ 还有 {} 项（点击查看）", hidden_count)),
                    );
                }

                cell_el = cell_el.child(list_container);
                row_div = row_div.child(cell_el);
            }

            week_rows.push(row_div);
        }

        // Assemble the month card
        let mut card = div()
            .flex_1()
            .p_3()
            .rounded_xl()
            .bg(palette.bg_surface)
            .border_1()
            .border_color(palette.border_subtle)
            .flex()
            .flex_col()
            .gap_2();

        if !is_admin {
            card = card.h_full().overflow_hidden();
        }

        card.child(
            // Month Header: Left title | CENTER `< 2026年9月 > 今天` navigation | Right stats
            div()
                .w_full()
                .flex()
                .items_center()
                .justify_between()
                .pb_1()
                .border_b_1()
                .border_color(palette.border_subtle)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .text_base()
                                .font_weight(gpui::FontWeight::BOLD)
                                .text_color(palette.text_primary)
                                .child(format!("{}年 {}月", year, month)),
                        )
                        .child(
                            div()
                                .px_2()
                                .py(px(1.0))
                                .rounded_md()
                                .bg(palette.bg_surface_alt)
                                .text_xs()
                                .text_color(palette.text_secondary)
                                .child(format!("{} 行日历网格", row_count)),
                        ),
                )
                // CENTERED Month Switcher `< 2026年9月 > 今天` (embedded right in the top center of month-header!)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .px_2()
                        .py_1()
                        .rounded_lg()
                        .bg(palette.bg_surface_alt)
                        .border_1()
                        .border_color(palette.border_subtle)
                        .child(
                            div()
                                .id(SharedString::from(format!("prev-month-{}-{}", year, month)))
                                .px_2()
                                .py(px(1.0))
                                .rounded_sm()
                                .bg(palette.bg_surface)
                                .text_xs()
                                .font_weight(gpui::FontWeight::BOLD)
                                .text_color(palette.text_primary)
                                .cursor_pointer()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.navigate_month(-1, cx);
                                }))
                                .child("◀ 上月"),
                        )
                        .child(
                            div()
                                .px_3()
                                .text_xs()
                                .font_weight(gpui::FontWeight::BOLD)
                                .text_color(palette.text_primary)
                                .child(format!("{}年{}月", self.current_year, self.current_month)),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("next-month-{}-{}", year, month)))
                                .px_2()
                                .py(px(1.0))
                                .rounded_sm()
                                .bg(palette.bg_surface)
                                .text_xs()
                                .font_weight(gpui::FontWeight::BOLD)
                                .text_color(palette.text_primary)
                                .cursor_pointer()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.navigate_month(1, cx);
                                }))
                                .child("下月 ▶"),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("today-btn-{}-{}", year, month)))
                                .ml_1()
                                .px_2()
                                .py(px(1.0))
                                .rounded_sm()
                                .bg(palette.accent_primary)
                                .text_xs()
                                .font_weight(gpui::FontWeight::BOLD)
                                .text_color(rgb(0xffffff))
                                .cursor_pointer()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.jump_to_today(cx);
                                }))
                                .child("今天"),
                        ),
                )
                // Right stats
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .text_xs()
                                .text_color(palette.text_secondary)
                                .child(format!(
                                    "当月事项: {} 项 (已完成 {})",
                                    month_memos_count, month_done_count
                                )),
                        ),
                ),
        )
        // Weekday header row
        .child(
            div()
                .w_full()
                .flex()
                .gap_1()
                .children(weekdays.iter().enumerate().map(|(i, wd)| {
                    let is_weekend = i == 0 || i == 6;
                    div()
                        .flex_1()
                        .py_1()
                        .rounded_md()
                        .bg(palette.bg_surface_alt)
                        .flex()
                        .justify_center()
                        .text_xs()
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .text_color(if is_weekend {
                            palette.accent_rose
                        } else {
                            palette.text_secondary
                        })
                        .child(*wd)
                })),
        )
        // Week rows container
        .child(
            div()
                .flex_1()
                .w_full()
                .flex()
                .flex_col()
                .gap_1()
                .when(!is_admin, |el| el.min_h(px(0.0)).overflow_hidden())
                .children(week_rows),
        )
    }

    fn render_calendar_tab(
        &mut self,
        user: &User,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let is_admin = user.is_admin();
        let y1 = self.current_year;
        let m1 = self.current_month;
        let (y2, m2) = shift_month(y1, m1, 1);

        if is_admin {
            // Manager View: Scrollable workspace with Team Leaderboard + Large Calendar Cards
            div()
                .id("manager-calendar-scroll")
                .flex_1()
                .w_full()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap_3()
                .pb_6()
                .child(self.render_manager_leaderboard(palette, cx))
                .child(
                    div()
                        .px_4()
                        .w_full()
                        .flex()
                        .gap_3()
                        .child(self.render_month_card(y1, m1, true, palette, cx))
                        .when(self.month_count == 2, |el| {
                            el.child(self.render_month_card(y2, m2, true, palette, cx))
                        }),
                )
        } else {
            // Employee View: Single-Screen Zero-Scroll Adaptive Calendar!
            div()
                .id("employee-calendar-viewport")
                .flex_1()
                .w_full()
                .h_full()
                .overflow_hidden()
                .px_4()
                .py_2()
                .flex()
                .gap_3()
                .child(self.render_month_card(y1, m1, false, palette, cx))
                .when(self.month_count == 2, |el| {
                    el.child(self.render_month_card(y2, m2, false, palette, cx))
                })
        }
    }

    fn render_weekly_plan_tab(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let monday = self.current_week_monday.clone();
        let sunday = shift_days(&monday, 6);
        let day_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

        let mut day_cols = Vec::with_capacity(7);
        for offset in 0..7 {
            let d_str = shift_days(&monday, offset);
            let day_memos = self.filtered_memos_for_date(&d_str);
            let d_for_add = d_str.clone();

            day_cols.push(
                div()
                    .flex_1()
                    .min_h(px(190.0))
                    .p_2()
                    .rounded_lg()
                    .bg(palette.bg_surface)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .pb_1()
                            .border_b_1()
                            .border_color(palette.border_subtle)
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.text_primary)
                                    .child(format!("{} ({})", day_names[offset as usize], &d_str[5..])),
                            )
                            .child(
                                div()
                                    .id(SharedString::from(format!("wk-add-{}", d_str)))
                                    .px_1()
                                    .rounded_sm()
                                    .bg(palette.bg_surface_alt)
                                    .text_xs()
                                    .text_color(palette.accent_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.open_new_memo_editor(&d_for_add, cx);
                                    }))
                                    .child("＋"),
                            ),
                    )
                    .children(day_memos.into_iter().map(|m| {
                        let m_clone = m.clone();
                        div()
                            .id(SharedString::from(format!("wk-memo-{}", m.id)))
                            .p_1()
                            .rounded_md()
                            .bg(palette.bg_surface_alt)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .text_xs()
                            .text_color(if m.completed {
                                palette.text_muted
                            } else {
                                palette.text_primary
                            })
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.open_existing_memo_editor(&m_clone, cx);
                            }))
                            .child(format!(
                                "{} {}",
                                if m.completed { "✅" } else { "⏳" },
                                m.title
                            ))
                    })),
            );
        }

        let goals_focused = self.active_input == ActiveInput::WeeklyGoals;
        let deliv_focused = self.active_input == ActiveInput::WeeklyDeliverables;
        let actual_focused = self.active_input == ActiveInput::WeeklyActual;
        let risks_focused = self.active_input == ActiveInput::WeeklyRisks;

        div()
            .id("weekly-plan-scroll")
            .flex_1()
            .w_full()
            .overflow_y_scroll()
            .p_4()
            .flex()
            .flex_col()
            .gap_4()
            // Top bar
            .child(
                div()
                    .p_3()
                    .rounded_xl()
                    .bg(palette.bg_surface)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .id("wk-prev-btn")
                                    .px_2()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.current_week_monday =
                                            shift_days(&this.current_week_monday, -7);
                                        this.refresh_all_data(cx);
                                    }))
                                    .child("◀ 上一周"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.text_primary)
                                    .child(format!("📅 周计划与周报周期：{} 至 {}", monday, sunday)),
                            )
                            .child(
                                div()
                                    .id("wk-next-btn")
                                    .px_2()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.current_week_monday =
                                            shift_days(&this.current_week_monday, 7);
                                        this.refresh_all_data(cx);
                                    }))
                                    .child("下一周 ▶"),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .id("wk-autogen-btn")
                                    .px_3()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.accent_purple_bg)
                                    .border_1()
                                    .border_color(palette.accent_purple)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_purple)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.generate_weekly_summary_from_memos(cx);
                                    }))
                                    .child("✨ 从本周日历自动汇总生成周报"),
                            )
                            .child(
                                div()
                                    .id("wk-save-btn")
                                    .px_3()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.accent_primary)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.save_current_weekly_summary(cx);
                                    }))
                                    .child("💾 保存周报到云端"),
                            ),
                    ),
            )
            // 7-day columns
            .child(div().w_full().flex().gap_2().children(day_cols))
            // 4-quadrant weekly report editor
            .child(
                div()
                    .w_full()
                    .flex()
                    .gap_3()
                    .child(
                        div()
                            .id("wk-quad-goals")
                            .flex_1()
                            .p_3()
                            .rounded_xl()
                            .bg(palette.bg_surface)
                            .border_2()
                            .border_color(if goals_focused {
                                palette.accent_primary
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .flex_col()
                            .gap_2()
                            .cursor_text()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_input = ActiveInput::WeeklyGoals;
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .child("🎯 一、本周核心目标 (点击编辑)"),
                            )
                            .child(
                                div()
                                    .min_h(px(90.0))
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .child(if self.weekly_goals.is_empty() {
                                        "点击输入本周核心目标...".to_string()
                                    } else if goals_focused {
                                        format!("{}|", self.weekly_goals)
                                    } else {
                                        self.weekly_goals.clone()
                                    }),
                            ),
                    )
                    .child(
                        div()
                            .id("wk-quad-deliv")
                            .flex_1()
                            .p_3()
                            .rounded_xl()
                            .bg(palette.bg_surface)
                            .border_2()
                            .border_color(if deliv_focused {
                                palette.accent_primary
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .flex_col()
                            .gap_2()
                            .cursor_text()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_input = ActiveInput::WeeklyDeliverables;
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_purple)
                                    .child("📦 二、关键交付物与里程碑 (点击编辑)"),
                            )
                            .child(
                                div()
                                    .min_h(px(90.0))
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .child(if self.weekly_deliverables.is_empty() {
                                        "点击输入关键交付结果...".to_string()
                                    } else if deliv_focused {
                                        format!("{}|", self.weekly_deliverables)
                                    } else {
                                        self.weekly_deliverables.clone()
                                    }),
                            ),
                    ),
            )
            .child(
                div()
                    .w_full()
                    .flex()
                    .gap_3()
                    .child(
                        div()
                            .id("wk-quad-actual")
                            .flex_1()
                            .p_3()
                            .rounded_xl()
                            .bg(palette.bg_surface)
                            .border_2()
                            .border_color(if actual_focused {
                                palette.accent_emerald
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .flex_col()
                            .gap_2()
                            .cursor_text()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_input = ActiveInput::WeeklyActual;
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_emerald)
                                    .child("✅ 三、实际完成情况总结 (点击编辑)"),
                            )
                            .child(
                                div()
                                    .min_h(px(90.0))
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .child(if self.weekly_actual.is_empty() {
                                        "可点击上方「从本周日历自动汇总」或直接输入...".to_string()
                                    } else if actual_focused {
                                        format!("{}|", self.weekly_actual)
                                    } else {
                                        self.weekly_actual.clone()
                                    }),
                            ),
                    )
                    .child(
                        div()
                            .id("wk-quad-risks")
                            .flex_1()
                            .p_3()
                            .rounded_xl()
                            .bg(palette.bg_surface)
                            .border_2()
                            .border_color(if risks_focused {
                                palette.accent_rose
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .flex_col()
                            .gap_2()
                            .cursor_text()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_input = ActiveInput::WeeklyRisks;
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_rose)
                                    .child("⚠️ 四、风险阻塞与下周协同需求 (点击编辑)"),
                            )
                            .child(
                                div()
                                    .min_h(px(90.0))
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .child(if self.weekly_risks.is_empty() {
                                        "点击输入风险点或需协调资源...".to_string()
                                    } else if risks_focused {
                                        format!("{}|", self.weekly_risks)
                                    } else {
                                        self.weekly_risks.clone()
                                    }),
                            ),
                    ),
            )
    }

    fn render_dashboard_tab(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let total = self.memos.len();
        let completed = self.memos.iter().filter(|m| m.completed).count();
        let pending = total.saturating_sub(completed);
        let praised = self
            .memos
            .iter()
            .filter(|m| m.is_liked || m.is_reviewed)
            .count();
        let rate = if total > 0 {
            (completed * 100) / total
        } else {
            0
        };
        let stats = self.compute_leaderboard();

        div()
            .id("dashboard-scroll")
            .flex_1()
            .w_full()
            .overflow_y_scroll()
            .p_4()
            .flex()
            .flex_col()
            .gap_4()
            // KPI Cards
            .child(
                div()
                    .w_full()
                    .flex()
                    .gap_3()
                    .child(
                        div()
                            .flex_1()
                            .p_4()
                            .rounded_xl()
                            .bg(palette.bg_surface)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child("📌 周期总工作事项"),
                            )
                            .child(
                                div()
                                    .text_2xl()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .child(format!("{}", total)),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .p_4()
                            .rounded_xl()
                            .bg(palette.bg_surface)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child("✅ 已按期闭环完成"),
                            )
                            .child(
                                div()
                                    .text_2xl()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_emerald)
                                    .child(format!("{} ({}%)", completed, rate)),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .p_4()
                            .rounded_xl()
                            .bg(palette.bg_surface)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child("⏳ 待推进/结转事项"),
                            )
                            .child(
                                div()
                                    .text_2xl()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_amber)
                                    .child(format!("{}", pending)),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .p_4()
                            .rounded_xl()
                            .bg(palette.bg_surface)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child("👏 管理端已阅与点赞"),
                            )
                            .child(
                                div()
                                    .text_2xl()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_purple)
                                    .child(format!("{}", praised)),
                            ),
                    ),
            )
            // Team Member Execution Matrix
            .child(
                div()
                    .p_4()
                    .rounded_xl()
                    .bg(palette.bg_surface)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(gpui::FontWeight::BOLD)
                            .text_color(palette.text_primary)
                            .child("📊 研发团队成员效能矩阵（点击成员可穿透至日历视图）"),
                    )
                    .children(stats.into_iter().enumerate().map(|(idx, st)| {
                        let uid_str = st.user_id.to_string();
                        div()
                            .id(SharedString::from(format!("dash-row-{}", st.user_id)))
                            .p_2()
                            .rounded_lg()
                            .bg(palette.bg_surface_alt)
                            .flex()
                            .items_center()
                            .justify_between()
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.selected_user_filter = uid_str.clone();
                                this.active_tab = ActiveTab::Calendar;
                                this.refresh_all_data(cx);
                            }))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_3()
                                    .child(
                                        div()
                                            .w(px(28.0))
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.text_secondary)
                                            .child(format!("#{}", idx + 1)),
                                    )
                                    .child(
                                        div()
                                            .w(px(140.0))
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.text_primary)
                                            .child(format!("{} ({})", st.name, st.department)),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(palette.text_secondary)
                                            .child(format!(
                                                "总计 {} 项 | 已完成 {} | 待办 {} | 👍 点赞 {} | ✓ 已阅 {}",
                                                st.total,
                                                st.completed,
                                                st.pending,
                                                st.liked,
                                                st.reviewed
                                            )),
                                    ),
                            )
                            .child(
                                div()
                                    .px_2()
                                    .py(px(2.0))
                                    .rounded_md()
                                    .bg(palette.accent_emerald_bg)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_emerald)
                                    .child(format!("达成率 {}%", st.rate)),
                            )
                    })),
            )
    }

    /// Memo Detail & Editor Modal
    fn render_editor_modal(
        &mut self,
        user: &User,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let is_admin = user.is_admin();
        let title_focused = self.active_input == ActiveInput::EditorTitle;
        let date_focused = self.active_input == ActiveInput::EditorDate;
        let content_focused = self.active_input == ActiveInput::EditorContent;
        let memo_id_opt = self.editor_memo_id;
        let colors = [
            "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899",
        ];

        div()
            .id("editor-modal-backdrop")
            .occlude()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .bg(rgba(0x00000077))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(540.0))
                    .p_5()
                    .rounded_xl()
                    .bg(palette.bg_modal)
                    .border_1()
                    .border_color(palette.border_strong)
                    .shadow_lg()
                    .flex()
                    .flex_col()
                    .gap_3()
                    // Modal Header
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .pb_2()
                            .border_b_1()
                            .border_color(palette.border_subtle)
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(
                                        div()
                                            .text_base()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.text_primary)
                                            .child(if memo_id_opt.is_some() {
                                                "📝 工作事项详情与编辑"
                                            } else {
                                                "➕ 新建工作事项"
                                            }),
                                    )
                                    .when(!self.editor_owner_name.is_empty(), |el| {
                                        el.child(
                                            div()
                                                .px_2()
                                                .py(px(1.0))
                                                .rounded_md()
                                                .bg(palette.accent_primary_bg)
                                                .text_xs()
                                                .text_color(palette.accent_primary)
                                                .child(format!("归属: {}", self.editor_owner_name)),
                                        )
                                    }),
                            )
                            .child(
                                div()
                                    .id("editor-close-btn")
                                    .px_2()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.editor_open = false;
                                        this.active_input = ActiveInput::None;
                                        cx.notify();
                                    }))
                                    .child("✕ 关闭"),
                            ),
                    )
                    // Manager Supervision Bar (if editing existing memo in Manager View)
                    .when_some(memo_id_opt.filter(|_| is_admin), |el, mid| {
                        el.child(
                            div()
                                .p_2()
                                .rounded_lg()
                                .bg(palette.bg_surface_alt)
                                .border_1()
                                .border_color(palette.border_subtle)
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_xs()
                                        .font_weight(gpui::FontWeight::BOLD)
                                        .text_color(palette.text_secondary)
                                        .child("👑 管理端督办互动："),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(
                                            div()
                                                .id("modal-mgr-review")
                                                .px_3()
                                                .py_1()
                                                .rounded_md()
                                                .bg(if self.editor_is_reviewed {
                                                    palette.accent_emerald
                                                } else {
                                                    palette.bg_surface
                                                })
                                                .border_1()
                                                .border_color(palette.accent_emerald)
                                                .text_xs()
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(if self.editor_is_reviewed {
                                                    rgb(0xffffff)
                                                } else {
                                                    palette.accent_emerald
                                                })
                                                .cursor_pointer()
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.trigger_manager_react(mid, "review", cx);
                                                }))
                                                .child(if self.editor_is_reviewed {
                                                    "✓ 已阅 (点击取消)"
                                                } else {
                                                    "✓ 标记已阅"
                                                }),
                                        )
                                        .child(
                                            div()
                                                .id("modal-mgr-like")
                                                .px_3()
                                                .py_1()
                                                .rounded_md()
                                                .bg(if self.editor_is_liked {
                                                    palette.accent_amber
                                                } else {
                                                    palette.bg_surface
                                                })
                                                .border_1()
                                                .border_color(palette.accent_amber)
                                                .text_xs()
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(if self.editor_is_liked {
                                                    rgb(0xffffff)
                                                } else {
                                                    palette.accent_amber
                                                })
                                                .cursor_pointer()
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.trigger_manager_react(mid, "like", cx);
                                                }))
                                                .child(if self.editor_is_liked {
                                                    "👍 已点赞 (点击取消)"
                                                } else {
                                                    "👍 点赞鼓励"
                                                }),
                                        )
                                        .child(
                                            div()
                                                .id("modal-mgr-urge")
                                                .px_3()
                                                .py_1()
                                                .rounded_md()
                                                .bg(palette.accent_rose_bg)
                                                .border_1()
                                                .border_color(palette.accent_rose)
                                                .text_xs()
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(palette.accent_rose)
                                                .cursor_pointer()
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.trigger_manager_urge(mid, cx);
                                                }))
                                                .child("⚡ 下发催办"),
                                        ),
                                ),
                        )
                    })
                    // Date & Color & Status row
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_2()
                            .child(
                                div()
                                    .id("editor-date-box")
                                    .px_3()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .border_1()
                                    .border_color(if date_focused {
                                        palette.accent_primary
                                    } else {
                                        palette.border_subtle
                                    })
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .cursor_text()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_input = ActiveInput::EditorDate;
                                        cx.notify();
                                    }))
                                    .child(format!(
                                        "📅 日期: {}{}",
                                        self.editor_date,
                                        if date_focused { "|" } else { "" }
                                    )),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .children(colors.into_iter().map(|hex| {
                                        let is_sel = self.editor_color == hex;
                                        let hex_str = hex.to_string();
                                        div()
                                            .id(SharedString::from(format!("color-pick-{}", hex)))
                                            .size(px(20.0))
                                            .rounded_full()
                                            .bg(parse_hex_color(hex))
                                            .border_2()
                                            .border_color(if is_sel {
                                                palette.text_primary
                                            } else {
                                                rgba(0x00000000)
                                            })
                                            .cursor_pointer()
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.editor_color = hex_str.clone();
                                                cx.notify();
                                            }))
                                    })),
                            )
                            .child(
                                div()
                                    .id("editor-status-toggle")
                                    .px_3()
                                    .py_1()
                                    .rounded_md()
                                    .bg(if self.editor_completed {
                                        palette.accent_emerald_bg
                                    } else {
                                        palette.accent_amber_bg
                                    })
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(if self.editor_completed {
                                        palette.accent_emerald
                                    } else {
                                        palette.accent_amber
                                    })
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.editor_completed = !this.editor_completed;
                                        cx.notify();
                                    }))
                                    .child(if self.editor_completed {
                                        "✅ 状态：已完成"
                                    } else {
                                        "⏳ 状态：待办推进中"
                                    }),
                            ),
                    )
                    // Title input
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child("事项标题"),
                            )
                            .child(
                                div()
                                    .id("editor-title-input")
                                    .h(px(36.0))
                                    .px_3()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if title_focused {
                                        palette.accent_primary
                                    } else {
                                        palette.border_subtle
                                    })
                                    .flex()
                                    .items_center()
                                    .text_sm()
                                    .text_color(palette.text_primary)
                                    .cursor_text()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_input = ActiveInput::EditorTitle;
                                        cx.notify();
                                    }))
                                    .child(if self.editor_title.is_empty() {
                                        if title_focused {
                                            "|".to_string()
                                        } else {
                                            "点击输入工作事项标题...".to_string()
                                        }
                                    } else if title_focused {
                                        format!("{}|", self.editor_title)
                                    } else {
                                        self.editor_title.clone()
                                    }),
                            ),
                    )
                    // Content input
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child("详细工作记录 / 备注（支持回车换行与 Ctrl+V 粘贴）"),
                            )
                            .child(
                                div()
                                    .id("editor-content-input")
                                    .min_h(px(110.0))
                                    .p_3()
                                    .rounded_md()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if content_focused {
                                        palette.accent_primary
                                    } else {
                                        palette.border_subtle
                                    })
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .cursor_text()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_input = ActiveInput::EditorContent;
                                        cx.notify();
                                    }))
                                    .child(if self.editor_content.is_empty() {
                                        if content_focused {
                                            "|".to_string()
                                        } else {
                                            "点击输入工作过程、交付产出或备注详情...".to_string()
                                        }
                                    } else if content_focused {
                                        format!("{}|", self.editor_content)
                                    } else {
                                        self.editor_content.clone()
                                    }),
                            ),
                    )
                    // Footer actions: Delete / Carryover to next day / Save
                    .child(
                        div()
                            .pt_2()
                            .border_t_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .when_some(memo_id_opt, |el, mid| {
                                        el.child(
                                            div()
                                                .id("editor-delete-btn")
                                                .px_3()
                                                .py_1()
                                                .rounded_md()
                                                .bg(palette.accent_rose_bg)
                                                .text_xs()
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(palette.accent_rose)
                                                .cursor_pointer()
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.delete_editor_memo(mid, cx);
                                                }))
                                                .child("🗑️ 删除事项"),
                                        )
                                    })
                                    .when(memo_id_opt.is_some() && !self.editor_completed, |el| {
                                        el.child(
                                            div()
                                                .id("editor-carryover-btn")
                                                .px_3()
                                                .py_1()
                                                .rounded_md()
                                                .bg(palette.accent_primary_bg)
                                                .border_1()
                                                .border_color(palette.accent_primary)
                                                .text_xs()
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(palette.accent_primary)
                                                .cursor_pointer()
                                                .on_click(cx.listener(|this, _, _, cx| {
                                                    let fake_memo = Memo {
                                                        id: this.editor_memo_id.unwrap_or(0),
                                                        owner_id: this.editor_owner_id.unwrap_or(0),
                                                        owner_name: this.editor_owner_name.clone(),
                                                        department_id: None,
                                                        department_name: None,
                                                        date: this.editor_date.clone(),
                                                        title: this.editor_title.clone(),
                                                        content_preview: this.editor_content.clone(),
                                                        content: Some(this.editor_content.clone()),
                                                        color: this.editor_color.clone(),
                                                        completed: false,
                                                        plan_kind: "memo".to_string(),
                                                        rollover_from_id: None,
                                                        rollover_to_id: None,
                                                        rollover_reason: String::new(),
                                                        due_time: None,
                                                        is_urged: false,
                                                        is_reviewed: false,
                                                        is_liked: false,
                                                    };
                                                    this.editor_open = false;
                                                    this.active_input = ActiveInput::None;
                                                    this.trigger_carryover(fake_memo, cx);
                                                }))
                                                .child("↪ 一键转到下一天"),
                                        )
                                    }),
                            )
                            .child(
                                div()
                                    .id("editor-save-btn")
                                    .px_4()
                                    .py_1()
                                    .rounded_md()
                                    .bg(palette.accent_primary)
                                    .text_sm()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.save_editor_memo(cx);
                                    }))
                                    .child("💾 保存事项"),
                            ),
                    ),
            )
    }

    /// Reminder Center Modal (Strictly pending/overdue/urged items — never review/like)
    fn render_reminder_modal(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let pending_reminders: Vec<Memo> = self
            .reminders
            .iter()
            .filter(|m| !m.completed)
            .cloned()
            .collect();
        let batch_ids: Vec<i64> = pending_reminders.iter().map(|m| m.id).collect();

        div()
            .id("reminder-modal-backdrop")
            .occlude()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .bg(rgba(0x00000077))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(560.0))
                    .max_h(px(520.0))
                    .p_5()
                    .rounded_xl()
                    .bg(palette.bg_modal)
                    .border_1()
                    .border_color(palette.border_strong)
                    .shadow_lg()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .pb_2()
                            .border_b_1()
                            .border_color(palette.border_subtle)
                            .child(
                                div()
                                    .text_base()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.text_primary)
                                    .child(format!(
                                        "🔔 待办与催办事项提醒（共 {} 项）",
                                        pending_reminders.len()
                                    )),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .when(!batch_ids.is_empty(), |el| {
                                        el.child(
                                            div()
                                                .id("batch-complete-btn")
                                                .px_3()
                                                .py_1()
                                                .rounded_md()
                                                .bg(palette.accent_emerald)
                                                .text_xs()
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(rgb(0xffffff))
                                                .cursor_pointer()
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    let ids = batch_ids.clone();
                                                    let api = this.api.clone();
                                                    this.reminder_modal_open = false;
                                                    cx.spawn(async move |this, cx| {
                                                        let _ = cx
                                                            .background_executor()
                                                            .spawn(async move {
                                                                api.batch_complete(&ids)
                                                            })
                                                            .await;
                                                        this.update(cx, |this, cx| {
                                                            this.show_toast(
                                                                "✅ 已一键完成全部待办提醒",
                                                                cx,
                                                            );
                                                            this.refresh_all_data(cx);
                                                        })
                                                        .ok();
                                                    })
                                                    .detach();
                                                }))
                                                .child("✅ 一键全部完成"),
                                        )
                                    })
                                    .child(
                                        div()
                                            .id("reminder-close-btn")
                                            .px_2()
                                            .py_1()
                                            .rounded_md()
                                            .bg(palette.bg_surface_alt)
                                            .text_xs()
                                            .text_color(palette.text_secondary)
                                            .cursor_pointer()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.reminder_modal_open = false;
                                                cx.notify();
                                            }))
                                            .child("✕ 关闭"),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .id("reminder-list-scroll")
                            .flex_1()
                            .overflow_y_scroll()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .when(pending_reminders.is_empty(), |el| {
                                el.child(
                                    div()
                                        .p_6()
                                        .flex()
                                        .justify_center()
                                        .text_sm()
                                        .text_color(palette.text_muted)
                                        .child("🎉 太棒了！当前没有任何逾期或催办未完成事项"),
                                )
                            })
                            .children(pending_reminders.into_iter().map(|m| {
                                let mid = m.id;
                                let m_carry = m.clone();
                                div()
                                    .id(SharedString::from(format!("rem-item-{}", m.id)))
                                    .p_3()
                                    .rounded_lg()
                                    .bg(palette.bg_surface_alt)
                                    .border_1()
                                    .border_color(if m.is_urged {
                                        palette.accent_rose
                                    } else {
                                        palette.border_subtle
                                    })
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap_1()
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .gap_2()
                                                    .when(m.is_urged, |el| {
                                                        el.child(
                                                            div()
                                                                .px_1()
                                                                .rounded_sm()
                                                                .bg(palette.accent_rose)
                                                                .text_xs()
                                                                .text_color(rgb(0xffffff))
                                                                .child("⚡催办"),
                                                        )
                                                    })
                                                    .child(
                                                        div()
                                                            .text_xs()
                                                            .text_color(palette.text_secondary)
                                                            .child(m.date.clone()),
                                                    )
                                                    .child(
                                                        div()
                                                            .text_sm()
                                                            .font_weight(gpui::FontWeight::BOLD)
                                                            .text_color(palette.text_primary)
                                                            .child(m.title.clone()),
                                                    ),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .child(
                                                div()
                                                    .id(SharedString::from(format!(
                                                        "rem-carry-{}",
                                                        mid
                                                    )))
                                                    .px_2()
                                                    .py_1()
                                                    .rounded_md()
                                                    .bg(palette.accent_primary_bg)
                                                    .text_xs()
                                                    .text_color(palette.accent_primary)
                                                    .cursor_pointer()
                                                    .on_click(cx.listener(move |this, _, _, cx| {
                                                        this.trigger_carryover(
                                                            m_carry.clone(),
                                                            cx,
                                                        );
                                                    }))
                                                    .child("↪ 转到下一天"),
                                            )
                                            .child(
                                                div()
                                                    .id(SharedString::from(format!(
                                                        "rem-done-{}",
                                                        mid
                                                    )))
                                                    .px_2()
                                                    .py_1()
                                                    .rounded_md()
                                                    .bg(palette.accent_emerald)
                                                    .text_xs()
                                                    .text_color(rgb(0xffffff))
                                                    .cursor_pointer()
                                                    .on_click(cx.listener(move |this, _, _, cx| {
                                                        this.toggle_memo_completed(mid, true, cx);
                                                    }))
                                                    .child("✓ 完成"),
                                            ),
                                    )
                            })),
                    ),
            )
    }

    /// Floating bottom pager for cycling through multiple praised/urged highlighted memos
    fn render_highlight_pager(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let total = self.highlight_memo_ids.len();
        let idx = self.highlight_index;
        let current_id = self.highlight_memo_ids.get(idx).copied().unwrap_or(0);
        let current_memo_info = self
            .memos
            .iter()
            .find(|m| m.id == current_id)
            .map(|m| format!("{} · {}", m.date, m.title))
            .unwrap_or_else(|| format!("事项 #{}", current_id));

        div()
            .absolute()
            .bottom_4()
            .left(px(280.0))
            .px_4()
            .py_2()
            .rounded_full()
            .bg(palette.bg_modal)
            .border_2()
            .border_color(palette.accent_emerald)
            .shadow_lg()
            .flex()
            .items_center()
            .gap_3()
            .child(
                div()
                    .id("hl-prev-btn")
                    .px_2()
                    .py(px(2.0))
                    .rounded_md()
                    .bg(palette.bg_surface_alt)
                    .text_xs()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(palette.text_primary)
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if total > 0 {
                            this.highlight_index = (this.highlight_index + total - 1) % total;
                            this.focus_current_highlighted_memo(cx);
                        }
                    }))
                    .child("◀ 上一条"),
            )
            .child(
                div()
                    .text_xs()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(palette.accent_emerald)
                    .child(format!(
                        "✨ 正在闪烁定位 ({}/{})：{}",
                        idx + 1,
                        total,
                        current_memo_info
                    )),
            )
            .child(
                div()
                    .id("hl-next-btn")
                    .px_2()
                    .py(px(2.0))
                    .rounded_md()
                    .bg(palette.bg_surface_alt)
                    .text_xs()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(palette.text_primary)
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if total > 0 {
                            this.highlight_index = (this.highlight_index + 1) % total;
                            this.focus_current_highlighted_memo(cx);
                        }
                    }))
                    .child("下一条 ▶"),
            )
            .child(
                div()
                    .id("hl-stop-btn")
                    .px_2()
                    .py(px(2.0))
                    .rounded_md()
                    .bg(palette.accent_rose_bg)
                    .text_xs()
                    .text_color(palette.accent_rose)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.highlight_memo_ids.clear();
                        this.highlight_tick = 0;
                        cx.notify();
                    }))
                    .child("✕ 结束定位"),
            )
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

        let show_editor = self.editor_open;
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
                    .child(self.render_top_notification_banners(palette, cx))
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
            // Highlight Pager Bar
            .when(show_hl_pager, |el| {
                el.child(self.render_highlight_pager(palette, cx))
            })
            // Editor Modal
            .when(show_editor, |el| {
                el.child(self.render_editor_modal(&user, palette, cx))
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
                        .bottom_4()
                        .right_4()
                        .px_4()
                        .py_2()
                        .rounded_lg()
                        .bg(palette.accent_primary)
                        .shadow_lg()
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
                        title: Some("智能工作日历备忘录 · GPUI 桌面版 (管理端 / 员工端)".into()),
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
                    app.quick_login_as("杨振", "0000", cx);
                }
            })
            .unwrap();
    });
}
