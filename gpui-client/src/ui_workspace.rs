use crate::{
    ActiveInput, ActiveTab, MemberStat, WorkCalendarApp,
    models::{
        DayCell, Memo, User, build_month_cells, current_year_month, iso_week_label, monday_of_date,
        month_key, shift_days, shift_month, short_md, today_date_str,
    },
    parse_hex_color,
    theme::{ThemeMode, ThemePalette},
};
use gpui::{
    Context, IntoElement, ParentElement, SharedString, StatefulInteractiveElement, Styled, div,
    prelude::*, px, rgb, rgba,
};

impl WorkCalendarApp {
    pub(crate) fn render_sidebar(
        &mut self,
        user: &User,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let is_admin = user.is_admin();
        let reminder_count = self.reminders.iter().filter(|m| !m.completed).count();

        if self.sidebar_collapsed {
            return div()
                .w(px(60.0))
                .h_full()
                .bg(palette.bg_sidebar)
                .border_r_1()
                .border_color(palette.border_subtle)
                .flex()
                .flex_col()
                .items_center()
                .py_4()
                .gap_3()
                .child(
                    div()
                        .id("sidebar-expand-icon")
                        .size(px(36.0))
                        .rounded_xl()
                        .bg(palette.accent_primary)
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_sm()
                        .text_color(rgb(0xffffff))
                        .cursor_pointer()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.sidebar_collapsed = false;
                            cx.notify();
                        }))
                        .child("📅"),
                )
                .child(
                    div()
                        .id("col-nav-cal")
                        .size(px(38.0))
                        .rounded_xl()
                        .bg(if self.active_tab == ActiveTab::Calendar {
                            palette.accent_primary_bg
                        } else {
                            rgba(0x00000000)
                        })
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(if self.active_tab == ActiveTab::Calendar {
                            palette.accent_primary
                        } else {
                            palette.text_secondary
                        })
                        .cursor_pointer()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.active_tab = ActiveTab::Calendar;
                            cx.notify();
                        }))
                        .child("⊞"),
                )
                .child(
                    div()
                        .id("col-nav-week")
                        .size(px(38.0))
                        .rounded_xl()
                        .bg(if self.active_tab == ActiveTab::WeeklyPlan {
                            palette.accent_primary_bg
                        } else {
                            rgba(0x00000000)
                        })
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(if self.active_tab == ActiveTab::WeeklyPlan {
                            palette.accent_primary
                        } else {
                            palette.text_secondary
                        })
                        .cursor_pointer()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.active_tab = ActiveTab::WeeklyPlan;
                            cx.notify();
                        }))
                        .child("☰"),
                );
        }

        let avatar_char = user
            .name()
            .chars()
            .next()
            .unwrap_or('用')
            .to_string();
        let job_str = user
            .job_title
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(if is_admin { "经理" } else { "工程师" });
        let dept_str = user
            .department_name
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("研发部");
        let role_subtitle = format!("{} · {}", job_str, dept_str);

        div()
            .w(px(236.0))
            .h_full()
            .bg(palette.bg_sidebar)
            .border_r_1()
            .border_color(palette.border_subtle)
            .p_4()
            .flex()
            .flex_col()
            .justify_between()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    // Brand Header: [📅] 工作日历 [PRO]
                    .child(
                        div()
                            .px_1()
                            .py_1()
                            .flex()
                            .items_center()
                            .gap_2p5()
                            .child(
                                div()
                                    .size(px(34.0))
                                    .rounded_xl()
                                    .bg(palette.accent_primary)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_base()
                                    .text_color(rgb(0xffffff))
                                    .child("📅"),
                            )
                            .child(
                                div()
                                    .text_lg()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.text_primary)
                                    .child("工作日历"),
                            )
                            .child(
                                div()
                                    .px_2()
                                    .py(px(1.0))
                                    .rounded_md()
                                    .bg(palette.accent_primary_bg)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .child("PRO"),
                            ),
                    )
                    // Group 1: 核心工作台
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .px_2()
                                    .pb_1()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_muted)
                                    .child("核心工作台"),
                            )
                            .child(self.render_sidebar_nav_item(
                                "nav-calendar",
                                "⊞",
                                "工作日历",
                                self.active_tab == ActiveTab::Calendar,
                                None,
                                palette,
                                cx.listener(|this, _, _, cx| {
                                    this.active_tab = ActiveTab::Calendar;
                                    cx.notify();
                                }),
                            ))
                            .child(self.render_sidebar_nav_item(
                                "nav-weekly",
                                "☰",
                                "周计划与周报",
                                self.active_tab == ActiveTab::WeeklyPlan,
                                None,
                                palette,
                                cx.listener(|this, _, _, cx| {
                                    this.active_tab = ActiveTab::WeeklyPlan;
                                    cx.notify();
                                }),
                            ))
                            .when(is_admin, |el| {
                                el.child(self.render_sidebar_nav_item(
                                    "nav-dashboard",
                                    "📈",
                                    "研发大屏",
                                    self.active_tab == ActiveTab::Dashboard,
                                    None,
                                    palette,
                                    cx.listener(|this, _, _, cx| {
                                        this.active_tab = ActiveTab::Dashboard;
                                        cx.notify();
                                    }),
                                ))
                            }),
                    )
                    // Group 2: 协同与管理
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .px_2()
                                    .pb_1()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_muted)
                                    .child("协同与管理"),
                            )
                            .when(is_admin, |el| {
                                el.child(self.render_sidebar_nav_item(
                                    "nav-task-pub",
                                    "🚀",
                                    "任务发布",
                                    self.task_pub_open,
                                    None,
                                    palette,
                                    cx.listener(|this, _, _, cx| {
                                        this.task_pub_open = true;
                                        this.task_pub_date = today_date_str();
                                        this.task_pub_title.clear();
                                        this.task_pub_content.clear();
                                        this.active_input = ActiveInput::TaskPubTitle;
                                        cx.notify();
                                    }),
                                ))
                            })
                            .child(self.render_sidebar_nav_item(
                                "nav-reminders",
                                "🔔",
                                "事项提醒",
                                self.reminder_modal_open,
                                if reminder_count > 0 {
                                    Some(reminder_count)
                                } else {
                                    None
                                },
                                palette,
                                cx.listener(|this, _, _, cx| {
                                    this.reminder_modal_open = !this.reminder_modal_open;
                                    cx.notify();
                                }),
                            ))
                            .when(is_admin, |el| {
                                el.child(self.render_sidebar_nav_item(
                                    "nav-data-mgmt",
                                    "🗄️",
                                    "数据管理",
                                    false,
                                    None,
                                    palette,
                                    cx.listener(|this, _, _, cx| {
                                        this.refresh_all_data(cx);
                                        this.show_toast(
                                            format!(
                                                "🗄️ 已同步服务器数据：共 {} 名成员、{} 条事项",
                                                this.users.len(),
                                                this.memos.len()
                                            ),
                                            cx,
                                        );
                                    }),
                                ))
                            })
                            .child(self.render_sidebar_nav_item(
                                "nav-export-excel",
                                "📗",
                                if is_admin { "Excel 导出" } else { "导出月报" },
                                false,
                                None,
                                palette,
                                cx.listener(|this, _, _, cx| {
                                    this.export_memos_csv(cx);
                                }),
                            ))
                            .when(is_admin, |el| {
                                el.child(self.render_sidebar_nav_item(
                                    "nav-import-data",
                                    "📥",
                                    "数据导入",
                                    false,
                                    None,
                                    palette,
                                    cx.listener(|this, _, _, cx| {
                                        this.open_new_memo_editor(&today_date_str(), false, cx);
                                    }),
                                ))
                            }),
                    )
                    // Group 3: 系统偏好
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .px_2()
                                    .pb_1()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_muted)
                                    .child("系统偏好"),
                            )
                            .child(self.render_sidebar_nav_item(
                                "nav-theme-mode",
                                if self.theme_mode == ThemeMode::Light {
                                    "☀️"
                                } else {
                                    "🌙"
                                },
                                if self.theme_mode == ThemeMode::Light {
                                    "浅色模式"
                                } else {
                                    "深色模式"
                                },
                                false,
                                None,
                                palette,
                                cx.listener(|this, _, _, cx| {
                                    this.theme_mode = match this.theme_mode {
                                        ThemeMode::Light => ThemeMode::Dark,
                                        ThemeMode::Dark => ThemeMode::Light,
                                    };
                                    cx.notify();
                                }),
                            ))
                            .child(self.render_sidebar_nav_item(
                                "nav-sys-settings",
                                "⚙️",
                                "系统设置",
                                false,
                                None,
                                palette,
                                cx.listener(|this, _, _, cx| {
                                    this.refresh_all_data(cx);
                                    this.show_toast("⚙️ 已刷新连接并同步最新系统配置", cx);
                                }),
                            )),
                    ),
            )
            // Bottom User Profile Card (matches Web .sidebar-user-card)
            .child(
                div()
                    .p_3()
                    .rounded_xl()
                    .bg(palette.bg_surface_alt)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2p5()
                            .child(
                                div()
                                    .size(px(36.0))
                                    .rounded_full()
                                    .bg(palette.accent_primary_bg)
                                    .border_1()
                                    .border_color(palette.border_subtle)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_sm()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .child(avatar_char),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.text_primary)
                                            .child(user.name().to_string()),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(palette.text_secondary)
                                            .child(role_subtitle),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .id("sidebar-logout-btn")
                            .size(px(28.0))
                            .rounded_lg()
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_sm()
                            .text_color(palette.text_secondary)
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.current_user = None;
                                this.api.token = None;
                                this.memos.clear();
                                this.reminders.clear();
                                this.notifications.clear();
                                this.highlight_memo_ids.clear();
                                cx.notify();
                            }))
                            .child("↪"),
                    ),
            )
    }

    fn render_sidebar_nav_item(
        &self,
        id: &'static str,
        icon: &'static str,
        label: &'static str,
        active: bool,
        badge: Option<usize>,
        palette: ThemePalette,
        on_click: impl Fn(&gpui::ClickEvent, &mut gpui::Window, &mut gpui::App) + 'static,
    ) -> impl IntoElement {
        div()
            .id(id)
            .px_3()
            .py_2()
            .rounded_xl()
            .bg(if active {
                palette.accent_primary_bg
            } else {
                rgba(0x00000000)
            })
            .flex()
            .items_center()
            .justify_between()
            .cursor_pointer()
            .on_click(on_click)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2p5()
                    .child(
                        div()
                            .text_sm()
                            .text_color(if active {
                                palette.accent_primary
                            } else {
                                palette.text_secondary
                            })
                            .child(icon),
                    )
                    .child(
                        div()
                            .text_xs()
                            .font_weight(if active {
                                gpui::FontWeight::BOLD
                            } else {
                                gpui::FontWeight::MEDIUM
                            })
                            .text_color(if active {
                                palette.accent_primary
                            } else {
                                palette.text_primary
                            })
                            .child(label),
                    ),
            )
            .when_some(badge, |el, count| {
                el.child(
                    div()
                        .px_1p5()
                        .py(px(1.0))
                        .rounded_full()
                        .bg(palette.accent_rose)
                        .text_xs()
                        .font_weight(gpui::FontWeight::BOLD)
                        .text_color(rgb(0xffffff))
                        .child(count.to_string()),
                )
            })
    }

    pub(crate) fn render_top_header(
        &mut self,
        user: &User,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let is_admin = user.is_admin();
        let search_focused = self.active_input == ActiveInput::SearchQuery;

        // Unread review / like notifications for Employee center pill banner
        let praise_notifs: Vec<_> = self
            .notifications
            .iter()
            .filter(|n| !n.is_read && (n.notif_type == "review" || n.notif_type == "like"))
            .collect();
        let review_cnt = praise_notifs
            .iter()
            .filter(|n| n.notif_type == "review")
            .count();
        let like_cnt = praise_notifs
            .iter()
            .filter(|n| n.notif_type == "like")
            .count();
        let praise_memo_ids: Vec<i64> = praise_notifs.iter().filter_map(|n| n.memo_id).collect();
        let praise_notif_ids: Vec<i64> = praise_notifs.iter().map(|n| n.id).collect();

        // Fallback: if employee has reviewed/liked memos in current month even after reading notifications,
        // or when unread notifications exist
        let has_praise_banner = !is_admin && !praise_notifs.is_empty();

        // Selected member label for Manager dropdown
        let selected_member_label = if self.selected_user_filter == "all" {
            "全部成员".to_string()
        } else {
            self.users
                .iter()
                .find(|u| u.id.to_string() == self.selected_user_filter)
                .map(|u| u.name().to_string())
                .unwrap_or_else(|| "全部成员".to_string())
        };

        div()
            .w_full()
            .h(px(58.0))
            .px_5()
            .bg(palette.bg_surface)
            .border_b_1()
            .border_color(palette.border_subtle)
            .flex()
            .items_center()
            .justify_between()
            // Left: Collapse sidebar button + Breadcrumb
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(
                        div()
                            .id("top-collapse-sidebar-btn")
                            .size(px(32.0))
                            .rounded_lg()
                            .bg(palette.bg_surface)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_xs()
                            .text_color(palette.text_secondary)
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.sidebar_collapsed = !this.sidebar_collapsed;
                                cx.notify();
                            }))
                            .child("◧"),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1p5()
                            .text_sm()
                            .font_weight(gpui::FontWeight::BOLD)
                            .text_color(palette.text_primary)
                            .child("📅")
                            .child(match self.active_tab {
                                ActiveTab::Calendar => "工作日历",
                                ActiveTab::WeeklyPlan => "周计划与周报",
                                ActiveTab::Dashboard => "研发大屏",
                            }),
                    ),
            )
            // Center: Dark-Teal Employee Praise Notification Pill Banner (matches 01_banner_with_calendar_locate_hint.png)
            .when(has_praise_banner, |el| {
                el.child(
                    div()
                        .px_3p5()
                        .py_1p5()
                        .rounded_full()
                        .bg(rgb(0x0f766e))
                        .shadow_md()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .id("header-praise-locate-btn")
                                .flex()
                                .items_center()
                                .gap_1p5()
                                .text_xs()
                                .font_weight(gpui::FontWeight::BOLD)
                                .text_color(rgb(0xffffff))
                                .cursor_pointer()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.start_highlight_memos(praise_memo_ids.clone(), cx);
                                }))
                                .child(format!(
                                    "✓ {} 条事项已审阅，👍 {} 个事项获点赞 (点击日历定位)",
                                    review_cnt, like_cnt
                                )),
                        )
                        .child(
                            div()
                                .id("header-praise-dismiss-btn")
                                .size(px(18.0))
                                .rounded_full()
                                .bg(rgba(0xffffff24))
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_xs()
                                .text_color(rgb(0xffffff))
                                .cursor_pointer()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.dismiss_praise_notifications(
                                        praise_notif_ids.clone(),
                                        cx,
                                    );
                                }))
                                .child("✕"),
                        ),
                )
            })
            // Right: Search + Member Selector (Manager) + Month Count Selector + Generate Weekly Report
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2p5()
                    // Search Box
                    .child(
                        div()
                            .id("top-search-box")
                            .w(px(190.0))
                            .h(px(34.0))
                            .px_3()
                            .rounded_lg()
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
                            .cursor_text()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_input = ActiveInput::SearchQuery;
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1p5()
                                    .text_xs()
                                    .text_color(if self.search_query.is_empty() {
                                        palette.text_muted
                                    } else {
                                        palette.text_primary
                                    })
                                    .child("🔍")
                                    .child(if self.search_query.is_empty() {
                                        if search_focused {
                                            "|".to_string()
                                        } else {
                                            "搜索备忘录...".to_string()
                                        }
                                    } else if search_focused {
                                        format!("{}|", self.search_query)
                                    } else {
                                        self.search_query.clone()
                                    }),
                            )
                            .when(!self.search_query.is_empty(), |el| {
                                el.child(
                                    div()
                                        .id("clear-search-btn")
                                        .text_xs()
                                        .text_color(palette.text_muted)
                                        .cursor_pointer()
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            cx.stop_propagation();
                                            this.search_query.clear();
                                            cx.notify();
                                        }))
                                        .child("✕"),
                                )
                            }),
                    )
                    // Manager Member Filter Dropdown Button: 👥 成员：[ 👥 全部成员 ▾ ]
                    .when(is_admin, |el| {
                        el.child(
                            div()
                                .flex()
                                .items_center()
                                .gap_1p5()
                                .child(
                                    div()
                                        .text_xs()
                                        .font_weight(gpui::FontWeight::MEDIUM)
                                        .text_color(palette.text_secondary)
                                        .child("👥 成员："),
                                )
                                .child(
                                    div()
                                        .id("header-member-dropdown-btn")
                                        .h(px(34.0))
                                        .px_3()
                                        .rounded_lg()
                                        .bg(palette.bg_surface)
                                        .border_1()
                                        .border_color(if self.member_dropdown_open {
                                            palette.accent_primary
                                        } else {
                                            palette.border_subtle
                                        })
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .text_xs()
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .text_color(palette.text_primary)
                                        .cursor_pointer()
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.member_dropdown_open = !this.member_dropdown_open;
                                            this.month_dropdown_open = false;
                                            cx.notify();
                                        }))
                                        .child("👥")
                                        .child(selected_member_label)
                                        .child("▾"),
                                ),
                        )
                    })
                    // Soft Blue Month Count Pill Container: 📅 月数：[ 📅 X个月 ▾ ]
                    .child(
                        div()
                            .px_2p5()
                            .py_1()
                            .rounded_xl()
                            .bg(palette.accent_primary_bg)
                            .flex()
                            .items_center()
                            .gap_1p5()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.accent_primary)
                                    .child("📅 月数："),
                            )
                            .child(
                                div()
                                    .id("header-month-dropdown-btn")
                                    .h(px(26.0))
                                    .px_2p5()
                                    .rounded_lg()
                                    .bg(palette.bg_surface)
                                    .border_1()
                                    .border_color(palette.border_subtle)
                                    .flex()
                                    .items_center()
                                    .gap_1p5()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.month_dropdown_open = !this.month_dropdown_open;
                                        this.member_dropdown_open = false;
                                        cx.notify();
                                    }))
                                    .child(format!("📅 {}个月 ▾", self.month_count)),
                            ),
                    )
                    // Outline Blue Button: [ 📄 生成周报 ]
                    .child(
                        div()
                            .id("header-gen-weekly-btn")
                            .h(px(34.0))
                            .px_3()
                            .rounded_lg()
                            .bg(palette.bg_surface)
                            .border_1()
                            .border_color(palette.accent_primary)
                            .flex()
                            .items_center()
                            .gap_1p5()
                            .text_xs()
                            .font_weight(gpui::FontWeight::BOLD)
                            .text_color(palette.accent_primary)
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_tab = ActiveTab::WeeklyPlan;
                                this.generate_weekly_summary_from_memos(cx);
                                this.weekly_report_preview_open = true;
                                cx.notify();
                            }))
                            .child("📄 生成周报"),
                    ),
            )
    }

    // ========================================================================
    // CALENDAR WORKSPACE TAB
    // ========================================================================

    pub(crate) fn render_calendar_tab(
        &mut self,
        user: &User,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let is_admin = user.is_admin();

        // Single-screen adaptive mode for Employee 1-month view (zero vertical scrolling!)
        if !is_admin && self.month_count == 1 {
            return div()
                .flex_1()
                .w_full()
                .h_full()
                .p_3()
                .overflow_hidden()
                .flex()
                .flex_col()
                .child(self.render_month_card(
                    self.current_year,
                    self.current_month,
                    true,
                    false,
                    palette,
                    cx,
                ))
                .into_any_element();
        }

        // Scrollable mode for Manager View or Multi-Month View
        let mut months_to_render = Vec::new();
        for i in 0..self.month_count {
            let (y, m) = shift_month(self.current_year, self.current_month, i as i32);
            months_to_render.push((y, m));
        }

        let (end_y, end_m) = months_to_render
            .last()
            .copied()
            .unwrap_or((self.current_year, self.current_month));
        let range_title = if self.month_count > 1 {
            format!(
                "{}年{}月 - {}年{}月",
                self.current_year, self.current_month, end_y, end_m
            )
        } else {
            format!("{}年{}月", self.current_year, self.current_month)
        };

        div()
            .id("calendar-workspace-scroll")
            .flex_1()
            .w_full()
            .h_full()
            .p_4()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_4()
            // Manager Team Completion Leaderboard
            .when(is_admin, |el| {
                el.child(self.render_manager_leaderboard(&range_title, palette, cx))
            })
            // Multi-month top centered floating pill navigation bar (matches desktop_1_light_calendar_podium.png)
            .when(self.month_count > 1, |el| {
                el.child(
                    div()
                        .w_full()
                        .flex()
                        .justify_center()
                        .child(self.render_centered_nav_pill(&range_title, palette, cx)),
                )
            })
            // Month Cards
            .children(months_to_render.into_iter().map(|(y, m)| {
                self.render_month_card(y, m, false, is_admin, palette, cx)
            }))
            .into_any_element()
    }

    fn render_centered_nav_pill(
        &self,
        label: &str,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        div()
            .px_2p5()
            .py_1p5()
            .rounded_full()
            .bg(palette.bg_surface)
            .border_1()
            .border_color(palette.border_subtle)
            .shadow_sm()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .id("cal-nav-prev")
                    .size(px(28.0))
                    .rounded_full()
                    .bg(palette.bg_surface_alt)
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_xs()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(palette.text_secondary)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        let (ny, nm) = shift_month(this.current_year, this.current_month, -1);
                        this.current_year = ny;
                        this.current_month = nm;
                        this.refresh_all_data(cx);
                    }))
                    .child("<"),
            )
            .child(
                div()
                    .px_4()
                    .py_1()
                    .rounded_full()
                    .bg(palette.bg_surface_alt)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .text_xs()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(palette.text_primary)
                    .child(label.to_string()),
            )
            .child(
                div()
                    .id("cal-nav-next")
                    .size(px(28.0))
                    .rounded_full()
                    .bg(palette.bg_surface_alt)
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_xs()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(palette.text_secondary)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        let (ny, nm) = shift_month(this.current_year, this.current_month, 1);
                        this.current_year = ny;
                        this.current_month = nm;
                        this.refresh_all_data(cx);
                    }))
                    .child(">"),
            )
            .child(
                div()
                    .id("cal-nav-today")
                    .px_3()
                    .py_1()
                    .rounded_full()
                    .bg(palette.bg_surface_alt)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .flex()
                    .items_center()
                    .gap_1()
                    .text_xs()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(palette.text_primary)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        let (y, m) = current_year_month();
                        this.current_year = y;
                        this.current_month = m;
                        this.refresh_all_data(cx);
                    }))
                    .child("📅 今天"),
            )
    }

    fn render_manager_leaderboard(
        &mut self,
        range_title: &str,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let stats = self.compute_leaderboard();
        let total_members = stats.len();
        let top_champion = stats.first().cloned();
        let display_count = if self.leaderboard_expanded {
            total_members
        } else {
            4.min(total_members)
        };
        let visible_stats: Vec<MemberStat> = stats.into_iter().take(display_count).collect();

        // Chunk visible_stats into rows of 4 for a clean 4-column grid
        let mut rows: Vec<Vec<(usize, MemberStat)>> = Vec::new();
        for (idx, item) in visible_stats.into_iter().enumerate() {
            if idx % 4 == 0 {
                rows.push(Vec::new());
            }
            if let Some(last_row) = rows.last_mut() {
                last_row.push((idx, item));
            }
        }

        div()
            .w_full()
            .p_5()
            .rounded_2xl()
            .bg(palette.bg_surface)
            .border_1()
            .border_color(palette.border_subtle)
            .shadow_sm()
            .flex()
            .flex_col()
            .gap_4()
            // Top Header Row: Left Title Block + Right Gold Champion Card
            .child(
                div()
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
                                    .w(px(136.0))
                                    .px_2p5()
                                    .py_0p5()
                                    .rounded_full()
                                    .bg(palette.accent_primary_bg)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .child("🏆 团队完成竞赛榜"),
                            )
                            .child(
                                div()
                                    .flex()
                                    . items_baseline()
                                    .gap_3()
                                    .child(
                                        div()
                                            .text_xl()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.text_primary)
                                            .child(format!("{} 完成榜", range_title)),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(palette.text_secondary)
                                            .child("按当前显示月份统计，完成率最高的人排在最前面"),
                                    ),
                            ),
                    )
                    // Right Gold Champion Card
                    .when_some(top_champion, |el, champ| {
                        el.child(
                            div()
                                .px_4()
                                .py_2p5()
                                .rounded_xl()
                                .bg(palette.gold_bg)
                                .border_1()
                                .border_color(palette.gold_border)
                                .flex()
                                .items_center()
                                .gap_3()
                                .child(
                                    div()
                                        .size(px(36.0))
                                        .rounded_full()
                                        .bg(rgb(0xf59e0b))
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .text_base()
                                        .text_color(rgb(0xffffff))
                                        .child("🏆"),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .child(
                                            div()
                                                .text_xs()
                                                .font_weight(gpui::FontWeight::SEMIBOLD)
                                                .text_color(palette.gold_text)
                                                .child("当前领先"),
                                        )
                                        .child(
                                            div()
                                                .text_sm()
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(palette.text_primary)
                                                .child(format!("{} · {}%", champ.name, champ.rate)),
                                        ),
                                ),
                        )
                    }),
            )
            // 4-Column Podium Grid Rows
            .children(rows.into_iter().map(|row| {
                div()
                    .w_full()
                    .flex()
                    .gap_3()
                    .children(row.into_iter().map(|(rank_idx, st)| {
                        let uid_str = st.user_id.to_string();
                        let is_selected = self.selected_user_filter == uid_str;
                        let is_rank1 = rank_idx == 0;
                        let rank_badge_bg = match rank_idx {
                            0 => rgb(0xd97706),
                            1 => rgb(0x64748b),
                            2 => rgb(0xb45309),
                            _ => palette.accent_primary,
                        };
                        let medal_suffix = match rank_idx {
                            0 => " 👑",
                            1 => " 🥈",
                            2 => " 🥉",
                            _ => "",
                        };

                        div()
                            .id(SharedString::from(format!("podium-card-{}", st.user_id)))
                            .flex_1()
                            .p_3p5()
                            .rounded_xl()
                            .bg(if is_rank1 {
                                palette.gold_bg
                            } else {
                                palette.bg_surface_alt
                            })
                            .border_1()
                            .border_color(if is_selected {
                                palette.accent_primary
                            } else if is_rank1 {
                                palette.gold_border
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .flex_col()
                            .gap_2p5()
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if this.selected_user_filter == uid_str {
                                    this.selected_user_filter = "all".to_string();
                                } else {
                                    this.selected_user_filter = uid_str.clone();
                                }
                                this.refresh_all_data(cx);
                            }))
                            // Card Top Row: Rank Circle + Name/Job + Rate%
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_2p5()
                                            .child(
                                                div()
                                                    .size(px(26.0))
                                                    .rounded_full()
                                                    .bg(rank_badge_bg)
                                                    .flex()
                                                    .items_center()
                                                    .justify_center()
                                                    .text_xs()
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(rgb(0xffffff))
                                                    .child((rank_idx + 1).to_string()),
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
                                                            .child(format!(
                                                                "{}{}",
                                                                st.name, medal_suffix
                                                            )),
                                                    )
                                                    .child(
                                                        div()
                                                            .text_xs()
                                                            .text_color(palette.text_secondary)
                                                            .child(format!(
                                                                "{} · {}",
                                                                st.job_title, st.department
                                                            )),
                                                    ),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .text_lg()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.accent_emerald)
                                            .child(format!("{}%", st.rate)),
                                    ),
                            )
                            // Progress Bar
                            .child(
                                div()
                                    .w_full()
                                    .h(px(6.0))
                                    .rounded_full()
                                    .bg(palette.border_subtle)
                                    .overflow_hidden()
                                    .child(
                                        div()
                                            .h_full()
                                            .w(gpui::relative((st.rate as f32) / 100.0))
                                            .rounded_full()
                                            .bg(palette.accent_emerald),
                                    ),
                            )
                            // Card Bottom Row: ● 完成 X/Y | ✓ 全部完成 / 待办 X 项
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .text_xs()
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_1()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(palette.accent_emerald)
                                            .child(format!("● 完成 {}/{}", st.completed, st.total)),
                                    )
                                    .child(
                                        div()
                                            .text_color(if st.pending == 0 {
                                                palette.accent_emerald
                                            } else {
                                                palette.text_secondary
                                            })
                                            .child(if st.pending == 0 {
                                                "✓ 全部完成".to_string()
                                            } else {
                                                format!("待办 {} 项", st.pending)
                                            }),
                                    ),
                            )
                    }))
            }))
            // Bottom Center Expand/Collapse Pill Button
            .when(total_members > 4, |el| {
                el.child(
                    div()
                        .w_full()
                        .flex()
                        .justify_center()
                        .pt_1()
                        .child(
                            div()
                                .id("leaderboard-expand-toggle")
                                .px_4()
                                .py_1p5()
                                .rounded_full()
                                .bg(palette.bg_surface_alt)
                                .border_1()
                                .border_color(palette.border_subtle)
                                .text_xs()
                                .font_weight(gpui::FontWeight::SEMIBOLD)
                                .text_color(palette.text_secondary)
                                .cursor_pointer()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.leaderboard_expanded = !this.leaderboard_expanded;
                                    cx.notify();
                                }))
                                .child(if self.leaderboard_expanded {
                                    "收起成员榜单 ▴".to_string()
                                } else {
                                    format!("展开全部成员 ({}人) ▾", total_members)
                                }),
                        ),
                )
            })
    }

    fn render_month_card(
        &self,
        year: i32,
        month: u32,
        compact_employee_mode: bool,
        is_admin: bool,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let today = today_date_str();
        let cells = build_month_cells(year, month, &today);
        let row_count = cells.len() / 7;
        let ym_prefix = month_key(year, month);

        let month_memos = self.filtered_memos_for_month(&ym_prefix);
        let total_cnt = month_memos.len();
        let done_cnt = month_memos.iter().filter(|m| m.completed).count();
        let pending_cnt = total_cnt.saturating_sub(done_cnt);
        let rate = if total_cnt > 0 {
            (done_cnt * 100) / total_cnt
        } else {
            100
        };
        let pending_ids: Vec<i64> = month_memos
            .iter()
            .filter(|m| !m.completed)
            .map(|m| m.id)
            .collect();

        let weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

        let mut rows_of_cells: Vec<Vec<DayCell>> = Vec::with_capacity(row_count);
        for r in 0..row_count {
            let start = r * 7;
            rows_of_cells.push(cells[start..start + 7].to_vec());
        }

        let nav_label = format!("{}年{}月", year, month);
        let show_inline_nav = self.month_count == 1;

        let card = div()
            .w_full()
            .when(compact_employee_mode, |el| el.flex_1().h_full())
            .p_4()
            .rounded_2xl()
            .bg(palette.bg_surface)
            .border_1()
            .border_color(palette.border_subtle)
            .shadow_sm()
            .flex()
            .flex_col()
            .gap_3()
            // Month Card Top Header: Left (2026年 9月) | Center (Nav Pill when month_count==1) | Right (Stats + Rate% + 一键完成)
            .child(
                div()
                    .w_full()
                    .flex()
                    .items_center()
                    .justify_between()
                    // Left: Bold Month Title
                    .child(
                        div()
                            .text_xl()
                            .font_weight(gpui::FontWeight::BOLD)
                            .text_color(palette.text_primary)
                            .child(format!("{}年 {}月", year, month)),
                    )
                    // Center: Inline Pill Navigation Bar (when 1-month mode)
                    .when(show_inline_nav, |el| {
                        el.child(self.render_centered_nav_pill(&nav_label, palette, cx))
                    })
                    // Right: Stats Pills [≡ 262] [✓ 259] [🕒 3] + (99%) + [✓ 一键完成]
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2p5()
                            .child(
                                div()
                                    .px_2p5()
                                    .py_1()
                                    .rounded_full()
                                    .bg(palette.bg_surface_alt)
                                    .border_1()
                                    .border_color(palette.border_subtle)
                                    .flex()
                                    .items_center()
                                    .gap_3()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .child(
                                        div()
                                            .text_color(palette.text_secondary)
                                            .child(format!("≡ {}", total_cnt)),
                                    )
                                    .child(
                                        div()
                                            .text_color(palette.accent_emerald)
                                            .child(format!("✓ {}", done_cnt)),
                                    )
                                    .child(
                                        div()
                                            .text_color(palette.accent_amber)
                                            .child(format!("🕒 {}", pending_cnt)),
                                    ),
                            )
                            .child(
                                div()
                                    .size(px(36.0))
                                    .rounded_full()
                                    .bg(palette.accent_primary_bg)
                                    .border_2()
                                    .border_color(palette.accent_primary)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .child(format!("{}%", rate)),
                            )
                            .child(
                                div()
                                    .id(SharedString::from(format!(
                                        "month-batch-done-{}-{}",
                                        year, month
                                    )))
                                    .px_3()
                                    .py_1p5()
                                    .rounded_lg()
                                    .bg(palette.accent_emerald)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .cursor_pointer()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        if pending_ids.is_empty() {
                                            this.show_toast("当前月份所有事项均已完成！", cx);
                                            return;
                                        }
                                        let ids = pending_ids.clone();
                                        let count = ids.len();
                                        let api = this.api.clone();
                                        cx.spawn(async move |this, cx| {
                                            let _ = cx
                                                .background_executor()
                                                .spawn(async move { api.batch_complete(&ids) })
                                                .await;
                                            this.update(cx, |this, cx| {
                                                this.show_toast(
                                                    format!(
                                                        "✅ 已一键完成本月 {} 项待办事项",
                                                        count
                                                    ),
                                                    cx,
                                                );
                                                this.refresh_all_data(cx);
                                            })
                                            .ok();
                                        })
                                        .detach();
                                    }))
                                    .child("✓ 一键完成"),
                            ),
                    ),
            )
            // Weekday Header Row
            .child(
                div()
                    .w_full()
                    .grid()
                    .grid_cols(7)
                    .gap_2()
                    .children(weekdays.into_iter().enumerate().map(|(idx, wd)| {
                        let is_weekend = idx == 0 || idx == 6;
                        div()
                            .py_1()
                            .flex()
                            .justify_center()
                            .text_xs()
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .text_color(if is_weekend {
                                palette.text_muted
                            } else {
                                palette.text_secondary
                            })
                            .child(wd)
                    })),
            )
            // Calendar Grid Rows
            .child(
                div()
                    .w_full()
                    .when(compact_employee_mode, |el| el.flex_1().h_full())
                    .flex()
                    .flex_col()
                    .gap_2()
                    .children(rows_of_cells.into_iter().map(|row_cells| {
                        div()
                            .w_full()
                            .when(compact_employee_mode, |el| el.flex_1().min_h(px(76.0)))
                            .when(!compact_employee_mode, |el| {
                                el.min_h(if is_admin { px(162.0) } else { px(128.0) })
                            })
                            .grid()
                            .grid_cols(7)
                            .gap_2()
                            .children(row_cells.into_iter().map(|cell| {
                                self.render_day_cell(
                                    cell,
                                    compact_employee_mode,
                                    is_admin,
                                    palette,
                                    cx,
                                )
                            }))
                    })),
            );

        card.into_any_element()
    }

    fn render_day_cell(
        &self,
        cell: DayCell,
        compact_employee_mode: bool,
        is_admin: bool,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let day_memos = self.filtered_memos_for_date(&cell.date_str);
        let memo_count = day_memos.len();
        let date_for_click = cell.date_str.clone();
        let max_visible = if compact_employee_mode { 3 } else { 5 };
        let active_hl_id = self
            .highlight_memo_ids
            .get(self.highlight_index)
            .copied();
        let pulse_on = self.highlight_tick > 0 && (self.highlight_tick % 2 == 1);

        div()
            .id(SharedString::from(format!("day-cell-{}", cell.date_str)))
            .h_full()
            .p_2()
            .rounded_xl()
            .bg(if cell.is_today {
                palette.bg_cell_today
            } else if cell.is_current_month {
                palette.bg_cell
            } else {
                palette.bg_cell_other
            })
            .border_1()
            .when(cell.is_today, |el| el.border_2())
            .border_color(if cell.is_today {
                palette.accent_primary
            } else {
                palette.border_subtle
            })
            .flex()
            .flex_col()
            .gap_1()
            .overflow_hidden()
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, _, cx| {
                this.open_new_memo_editor(&date_for_click, false, cx);
            }))
            // Cell Top Bar: Day Number on Left + Circular Count Pill on Right
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
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
                            .child(cell.day_num.to_string()),
                    )
                    .when(memo_count > 0, |el| {
                        el.child(
                            div()
                                .px_1p5()
                                .py(px(1.0))
                                .rounded_full()
                                .bg(palette.accent_primary_bg)
                                .text_xs()
                                .font_weight(gpui::FontWeight::BOLD)
                                .text_color(palette.accent_primary)
                                .child(memo_count.to_string()),
                        )
                    }),
            )
            // Memo Pills List
            .child(
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .overflow_hidden()
                    .children(
                        day_memos
                            .iter()
                            .take(max_visible)
                            .cloned()
                            .map(|memo| {
                                let mid = memo.id;
                                let memo_for_edit = memo.clone();
                                let memo_for_carry = memo.clone();
                                let is_hl = active_hl_id == Some(mid)
                                    || (self.highlight_tick > 0
                                        && self.highlight_memo_ids.contains(&mid));
                                let dot_color = if memo.completed {
                                    palette.accent_emerald
                                } else {
                                    parse_hex_color(&memo.color)
                                };
                                let short_owner: String =
                                    memo.owner_name.chars().take(3).collect();

                                div()
                                    .id(SharedString::from(format!("memo-pill-{}", mid)))
                                    .px_2()
                                    .py(px(3.0))
                                    .rounded_lg()
                                    .bg(if is_hl && pulse_on {
                                        palette.accent_emerald_bg
                                    } else {
                                        palette.bg_pill
                                    })
                                    .border_1()
                                    .border_color(if is_hl {
                                        palette.accent_emerald
                                    } else {
                                        rgba(0x00000000)
                                    })
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .gap_1()
                                    .overflow_hidden()
                                    .cursor_pointer()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        cx.stop_propagation();
                                        this.open_existing_memo_editor(&memo_for_edit, cx);
                                    }))
                                    // Left: Colored Status Dot + Title
                                    .child(
                                        div()
                                            .flex_1()
                                            .flex()
                                            .items_center()
                                            .gap_1p5()
                                            .overflow_hidden()
                                            .child(
                                                div()
                                                    .size(px(6.0))
                                                    .rounded_full()
                                                    .bg(dot_color),
                                            )
                                            .child(
                                                div()
                                                    .flex_1()
                                                    .overflow_hidden()
                                                    .whitespace_nowrap()
                                                    .text_xs()
                                                    .when(memo.completed, |el| el.line_through())
                                                    .text_color(if memo.completed {
                                                        palette.text_muted
                                                    } else {
                                                        palette.text_primary
                                                    })
                                                    .child(memo.title.clone()),
                                            ),
                                    )
                                    // Right: Manager Owner Tag + Stamps OR Employee Stamps + Carryover
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_1()
                                            .when(is_admin && !short_owner.is_empty(), |el| {
                                                el.child(
                                                    div()
                                                        .px_1()
                                                        .rounded_sm()
                                                        .bg(palette.bg_surface)
                                                        .text_xs()
                                                        .text_color(palette.text_secondary)
                                                        .child(short_owner),
                                                )
                                            })
                                            .when(memo.is_reviewed, |el| {
                                                el.child(
                                                    div()
                                                        .text_xs()
                                                        .font_weight(gpui::FontWeight::BOLD)
                                                        .text_color(palette.accent_emerald)
                                                        .child("✓"),
                                                )
                                            })
                                            .when(memo.is_liked, |el| {
                                                el.child(
                                                    div()
                                                        .text_xs()
                                                        .text_color(palette.accent_amber)
                                                        .child("👍"),
                                                )
                                            })
                                            .when(!is_admin && !memo.completed, |el| {
                                                el.child(
                                                    div()
                                                        .id(SharedString::from(format!(
                                                            "pill-carry-{}",
                                                            mid
                                                        )))
                                                        .px_1()
                                                        .rounded_sm()
                                                        .text_xs()
                                                        .font_weight(gpui::FontWeight::BOLD)
                                                        .text_color(palette.accent_primary)
                                                        .cursor_pointer()
                                                        .on_click(cx.listener(
                                                            move |this, _, _, cx| {
                                                                cx.stop_propagation();
                                                                this.trigger_carryover(
                                                                    memo_for_carry.clone(),
                                                                    cx,
                                                                );
                                                            },
                                                        ))
                                                        .child("↪"),
                                                )
                                            }),
                                    )
                            }),
                    )
                    .when(memo_count > max_visible, |el| {
                        el.child(
                            div()
                                .px_1()
                                .text_xs()
                                .font_weight(gpui::FontWeight::SEMIBOLD)
                                .text_color(palette.accent_primary)
                                .child(format!("+ 还有 {} 项...", memo_count - max_visible)),
                        )
                    }),
            )
            .into_any_element()
    }

    // ========================================================================
    // WEEKLY PLAN & REPORT TAB (Matches desktop_7_dark_weekly_plan.png 1:1)
    // ========================================================================

    pub(crate) fn render_weekly_plan_tab(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let week_end = shift_days(&self.current_week_monday, 6);
        let week_label = iso_week_label(&self.current_week_monday);
        let today = today_date_str();

        let week_memos: Vec<Memo> = self
            .memos
            .iter()
            .filter(|m| {
                if m.date < self.current_week_monday || m.date > week_end {
                    return false;
                }
                if !self.weekly_team_mode && self.selected_user_filter != "all" {
                    if m.owner_id.to_string() != self.selected_user_filter {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect();

        let total_cnt = week_memos.len();
        let done_cnt = week_memos.iter().filter(|m| m.completed).count();
        let in_prog_cnt = total_cnt.saturating_sub(done_cnt);
        let rate = if total_cnt > 0 {
            (done_cnt * 100) / total_cnt
        } else {
            0
        };

        let day_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

        div()
            .flex_1()
            .w_full()
            .h_full()
            .p_4()
            .overflow_hidden()
            .flex()
            .flex_col()
            .gap_3()
            // Top Hero Banner Card (.weekly-plan-hero)
            .child(
                div()
                    .w_full()
                    .px_5()
                    .py_3p5()
                    .rounded_2xl()
                    .bg(palette.bg_surface)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .shadow_sm()
                    .flex()
                    .items_center()
                    .justify_between()
                    // Left: [← 返回月历] | 📅 周工作计划
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .child(
                                div()
                                    .id("wk-back-to-cal-btn")
                                    .px_3()
                                    .py_1p5()
                                    .rounded_xl()
                                    .bg(palette.bg_surface_alt)
                                    .border_1()
                                    .border_color(palette.border_subtle)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_tab = ActiveTab::Calendar;
                                        cx.notify();
                                    }))
                                    .child("← 返回月历"),
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
                                            .child("📅 周工作计划"),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(palette.text_secondary)
                                            .child("聚焦本周核心目标，高效跟进每日排期与执行"),
                                    ),
                            ),
                    )
                    // Center: Week Navigation Pill (< 2026年 第40周 (9/28 ~ 10/4) > [本周])
                    .child(
                        div()
                            .px_2p5()
                            .py_1()
                            .rounded_full()
                            .bg(palette.bg_surface_alt)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .id("wk-nav-prev")
                                    .size(px(26.0))
                                    .rounded_full()
                                    .bg(palette.bg_surface)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_xs()
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.current_week_monday =
                                            shift_days(&this.current_week_monday, -7);
                                        this.refresh_all_data(cx);
                                    }))
                                    .child("<"),
                            )
                            .child(
                                div()
                                    .px_3()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.text_primary)
                                    .child(week_label),
                            )
                            .child(
                                div()
                                    .id("wk-nav-next")
                                    .size(px(26.0))
                                    .rounded_full()
                                    .bg(palette.bg_surface)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_xs()
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.current_week_monday =
                                            shift_days(&this.current_week_monday, 7);
                                        this.refresh_all_data(cx);
                                    }))
                                    .child(">"),
                            )
                            .child(
                                div()
                                    .id("wk-nav-this-week")
                                    .px_2p5()
                                    .py_0p5()
                                    .rounded_full()
                                    .bg(palette.accent_primary)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.current_week_monday =
                                            monday_of_date(&today_date_str());
                                        this.refresh_all_data(cx);
                                    }))
                                    .child("本周"),
                            ),
                    )
                    // Right: Stats Pills (计划 X 项 | ✓ 完成 X | ⏳ 进行中 X | 📈 达成 X%)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .px_2p5()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.bg_surface_alt)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_primary)
                                    .child(format!("📋 计划 {} 项", total_cnt)),
                            )
                            .child(
                                div()
                                    .px_2p5()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.accent_emerald_bg)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.accent_emerald)
                                    .child(format!("✓ 完成 {}", done_cnt)),
                            )
                            .child(
                                div()
                                    .px_2p5()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.accent_amber_bg)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.accent_amber)
                                    .child(format!("⏳ 进行中 {}", in_prog_cnt)),
                            )
                            .child(
                                div()
                                    .px_2p5()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.accent_primary_bg)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .child(format!("📈 达成 {}%", rate)),
                            ),
                    ),
            )
            // Sub-Toolbar & Target Strip Row
            .child(
                div()
                    .w_full()
                    .px_4()
                    .py_2p5()
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
                            .gap_3()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_primary)
                                    .child(format!(
                                        "🚩 本周目标：{}",
                                        if self.weekly_goals.is_empty() {
                                            "暂未填写本周核心目标"
                                        } else {
                                            &self.weekly_goals
                                        }
                                    )),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child(format!(
                                        "📦 关键交付物：{}",
                                        if self.weekly_deliverables.is_empty() {
                                            "暂未填写"
                                        } else {
                                            &self.weekly_deliverables
                                        }
                                    )),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .id("wk-mode-toggle")
                                    .px_3()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.bg_surface_alt)
                                    .border_1()
                                    .border_color(palette.border_subtle)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.weekly_team_mode = !this.weekly_team_mode;
                                        cx.notify();
                                    }))
                                    .child(if self.weekly_team_mode {
                                        "👥 全员看板"
                                    } else {
                                        "👤 个人计划"
                                    }),
                            )
                            .child(
                                div()
                                    .id("wk-edit-summary-btn")
                                    .px_3()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.accent_primary_bg)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.weekly_summary_modal_open = true;
                                        this.active_input = ActiveInput::WeeklyGoals;
                                        cx.notify();
                                    }))
                                    .child("🎯 目标与复盘"),
                            )
                            .child(
                                div()
                                    .id("wk-preview-report-btn")
                                    .px_3()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.accent_primary)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.generate_weekly_summary_from_memos(cx);
                                        this.weekly_report_preview_open = true;
                                        cx.notify();
                                    }))
                                    .child("📋 预览周报"),
                            ),
                    ),
            )
            // 7-Column Weekly Kanban Grid (周一 .. 周日)
            .child(
                div()
                    .flex_1()
                    .w_full()
                    .grid()
                    .grid_cols(7)
                    .gap_2p5()
                    .overflow_hidden()
                    .children((0..7usize).map(|day_idx| {
                        let d_str = shift_days(&self.current_week_monday, day_idx as i64);
                        let is_today = d_str == today;
                        let col_memos: Vec<Memo> = week_memos
                            .iter()
                            .filter(|m| m.date == d_str)
                            .cloned()
                            .collect();
                        let input_focused =
                            self.active_input == ActiveInput::WeeklyDayInput(day_idx);
                        let input_val = self.weekly_day_inputs[day_idx].clone();
                        let d_for_add = d_str.clone();

                        div()
                            .h_full()
                            .p_2p5()
                            .rounded_2xl()
                            .bg(palette.bg_surface)
                            .border_1()
                            .when(is_today, |el| el.border_2())
                            .border_color(if is_today {
                                palette.accent_primary
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .flex_col()
                            .gap_2()
                            .overflow_hidden()
                            // Column Header: 周一 9/28 + Count badge
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_1p5()
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(if is_today {
                                                        palette.accent_primary
                                                    } else {
                                                        palette.text_primary
                                                    })
                                                    .child(day_names[day_idx]),
                                            )
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .text_color(palette.text_secondary)
                                                    .child(short_md(&d_str)),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .px_1p5()
                                            .rounded_full()
                                            .bg(palette.bg_pill)
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.text_secondary)
                                            .child(col_memos.len().to_string()),
                                    ),
                            )
                            // Quick Add Input Box (+ 添加计划，回车保存)
                            .child(
                                div()
                                    .id(SharedString::from(format!("wk-quick-input-{}", day_idx)))
                                    .h(px(32.0))
                                    .px_2p5()
                                    .rounded_lg()
                                    .bg(palette.bg_surface_alt)
                                    .border_1()
                                    .border_color(if input_focused {
                                        palette.accent_primary
                                    } else {
                                        palette.border_subtle
                                    })
                                    .flex()
                                    .items_center()
                                    .text_xs()
                                    .text_color(if input_val.is_empty() {
                                        palette.text_muted
                                    } else {
                                        palette.text_primary
                                    })
                                    .cursor_text()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.active_input = ActiveInput::WeeklyDayInput(day_idx);
                                        cx.notify();
                                    }))
                                    .child(if input_val.is_empty() {
                                        if input_focused {
                                            "|".to_string()
                                        } else {
                                            "+ 添加计划，回车保存".to_string()
                                        }
                                    } else if input_focused {
                                        format!("{}|", input_val)
                                    } else {
                                        input_val
                                    }),
                            )
                            // Day Plan Cards Scroll List
                            .child(
                                div()
                                    .id(SharedString::from(format!("wk-col-scroll-{}", day_idx)))
                                    .flex_1()
                                    .overflow_y_scroll()
                                    .flex()
                                    .flex_col()
                                    .gap_2()
                                    .when(col_memos.is_empty(), |el| {
                                        el.child(
                                            div()
                                                .id(SharedString::from(format!(
                                                    "wk-empty-add-{}",
                                                    day_idx
                                                )))
                                                .mt_6()
                                                .flex()
                                                .flex_col()
                                                .items_center()
                                                .gap_1()
                                                .text_xs()
                                                .text_color(palette.text_muted)
                                                .cursor_pointer()
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.open_new_memo_editor(
                                                        &d_for_add, true, cx,
                                                    );
                                                }))
                                                .child("📋 暂无计划")
                                                .child("点击添加详细计划"),
                                        )
                                    })
                                    .children(col_memos.into_iter().map(|m| {
                                        let mid = m.id;
                                        let new_done = !m.completed;
                                        let m_edit = m.clone();
                                        let m_carry = m.clone();
                                        div()
                                            .id(SharedString::from(format!("wk-card-{}", mid)))
                                            .p_2p5()
                                            .rounded_xl()
                                            .bg(palette.bg_surface_alt)
                                            .border_1()
                                            .border_color(palette.border_subtle)
                                            .flex()
                                            .flex_col()
                                            .gap_1p5()
                                            .cursor_pointer()
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.open_existing_memo_editor(&m_edit, cx);
                                            }))
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_start()
                                                    .gap_1p5()
                                                    .child(
                                                        div()
                                                            .id(SharedString::from(format!(
                                                                "wk-chk-{}",
                                                                mid
                                                            )))
                                                            .size(px(16.0))
                                                            .rounded_sm()
                                                            .bg(if m.completed {
                                                                palette.accent_emerald
                                                            } else {
                                                                palette.bg_surface
                                                            })
                                                            .border_1()
                                                            .border_color(if m.completed {
                                                                palette.accent_emerald
                                                            } else {
                                                                palette.border_strong
                                                            })
                                                            .flex()
                                                            .items_center()
                                                            .justify_center()
                                                            .text_xs()
                                                            .text_color(rgb(0xffffff))
                                                            .cursor_pointer()
                                                            .on_click(cx.listener(
                                                                move |this, _, _, cx| {
                                                                    cx.stop_propagation();
                                                                    this.toggle_memo_completed(
                                                                        mid, new_done, cx,
                                                                    );
                                                                },
                                                            ))
                                                            .child(if m.completed {
                                                                "✓"
                                                            } else {
                                                                ""
                                                            }),
                                                    )
                                                    .child(
                                                        div()
                                                            .flex_1()
                                                            .text_xs()
                                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                                            .when(m.completed, |el| {
                                                                el.line_through()
                                                            })
                                                            .text_color(if m.completed {
                                                                palette.text_muted
                                                            } else {
                                                                palette.text_primary
                                                            })
                                                            .child(m.title.clone()),
                                                    ),
                                            )
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .justify_between()
                                                    .text_xs()
                                                    .child(
                                                        div()
                                                            .text_color(palette.text_secondary)
                                                            .child(m.owner_name.clone()),
                                                    )
                                                    .when(!m.completed, |el| {
                                                        el.child(
                                                            div()
                                                                .id(SharedString::from(format!(
                                                                    "wk-carry-{}",
                                                                    mid
                                                                )))
                                                                .text_color(palette.accent_primary)
                                                                .font_weight(
                                                                    gpui::FontWeight::BOLD,
                                                                )
                                                                .cursor_pointer()
                                                                .on_click(cx.listener(
                                                                    move |this, _, _, cx| {
                                                                        cx.stop_propagation();
                                                                        this.trigger_carryover(
                                                                            m_carry.clone(),
                                                                            cx,
                                                                        );
                                                                    },
                                                                ))
                                                                .child("↪ 顺延"),
                                                        )
                                                    }),
                                            )
                                    })),
                            )
                    })),
            )
    }

    // ========================================================================
    // R&D DASHBOARD TAB (Manager 📈 研发大屏)
    // ========================================================================

    pub(crate) fn render_dashboard_tab(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let stats = self.compute_leaderboard();
        let total_memos = self.memos.len();
        let completed_memos = self.memos.iter().filter(|m| m.completed).count();
        let pending_memos = total_memos.saturating_sub(completed_memos);
        let praised_memos = self
            .memos
            .iter()
            .filter(|m| m.is_liked || m.is_reviewed)
            .count();
        let overall_rate = if total_memos > 0 {
            (completed_memos * 100) / total_memos
        } else {
            0
        };

        div()
            .id("dashboard-scroll")
            .flex_1()
            .w_full()
            .h_full()
            .p_5()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_4()
            // Top KPI Cards
            .child(
                div()
                    .w_full()
                    .grid()
                    .grid_cols(4)
                    .gap_4()
                    .child(self.render_kpi_card(
                        "📊 视图总排期事项",
                        format!("{} 项", total_memos),
                        "包含当前显示月份全部研发任务",
                        palette.accent_primary,
                        palette,
                    ))
                    .child(self.render_kpi_card(
                        "✅ 已按期交付完成",
                        format!("{} 项 ({}%)", completed_memos, overall_rate),
                        "团队整体执行达成率",
                        palette.accent_emerald,
                        palette,
                    ))
                    .child(self.render_kpi_card(
                        "⏳ 待办推进中",
                        format!("{} 项", pending_memos),
                        "支持一键结转与主管催办",
                        palette.accent_amber,
                        palette,
                    ))
                    .child(self.render_kpi_card(
                        "👍 已审阅与点赞互动",
                        format!("{} 次", praised_memos),
                        "主管实时批阅与激励反馈",
                        palette.accent_purple,
                        palette,
                    )),
            )
            // Full Team Matrix Table
            .child(
                div()
                    .w_full()
                    .p_5()
                    .rounded_2xl()
                    .bg(palette.bg_surface)
                    .border_1()
                    .border_color(palette.border_subtle)
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
                                    .text_base()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.text_primary)
                                    .child("📈 研发团队全员效能排行榜（点击任意行穿透查看该员工日历）"),
                            )
                            .child(
                                div()
                                    .id("dash-back-cal-btn")
                                    .px_3()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.accent_primary)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_tab = ActiveTab::Calendar;
                                        cx.notify();
                                    }))
                                    .child("返回月历全景 →"),
                            ),
                    )
                    .children(stats.into_iter().enumerate().map(|(idx, st)| {
                        let uid_str = st.user_id.to_string();
                        div()
                            .id(SharedString::from(format!("dash-row-{}", st.user_id)))
                            .p_3()
                            .rounded_xl()
                            .bg(palette.bg_surface_alt)
                            .border_1()
                            .border_color(palette.border_subtle)
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
                                            .size(px(26.0))
                                            .rounded_full()
                                            .bg(palette.accent_primary)
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(rgb(0xffffff))
                                            .child((idx + 1).to_string()),
                                    )
                                    .child(
                                        div()
                                            .text_sm()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.text_primary)
                                            .child(st.name),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(palette.text_secondary)
                                            .child(format!("{} · {}", st.job_title, st.department)),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_4()
                                    .text_xs()
                                    .child(format!("总事项: {}", st.total))
                                    .child(
                                        div()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.accent_emerald)
                                            .child(format!("已完成: {}", st.completed)),
                                    )
                                    .child(
                                        div()
                                            .text_color(palette.accent_amber)
                                            .child(format!("待办: {}", st.pending)),
                                    )
                                    .child(
                                        div()
                                            .px_2p5()
                                            .py_0p5()
                                            .rounded_full()
                                            .bg(palette.accent_emerald_bg)
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.accent_emerald)
                                            .child(format!("达成率 {}%", st.rate)),
                                    ),
                            )
                    })),
            )
    }

    fn render_kpi_card(
        &self,
        title: &'static str,
        val: String,
        sub: &'static str,
        color: gpui::Rgba,
        palette: ThemePalette,
    ) -> impl IntoElement {
        div()
            .p_4()
            .rounded_2xl()
            .bg(palette.bg_surface)
            .border_1()
            .border_color(palette.border_subtle)
            .flex()
            .flex_col()
            .gap_1p5()
            .child(
                div()
                    .text_xs()
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_color(palette.text_secondary)
                    .child(title),
            )
            .child(
                div()
                    .text_2xl()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(color)
                    .child(val),
            )
            .child(div().text_xs().text_color(palette.text_muted).child(sub))
    }
}
