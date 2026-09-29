use crate::{
    ActiveInput, WorkCalendarApp,
    models::{
        Memo, User, friday_of_date, iso_week_label, next_day_str, next_monday_of_date, shift_days,
        short_md, today_date_str,
    },
    parse_hex_color,
    theme::ThemePalette,
};
use gpui::{
    Context, IntoElement, ParentElement, SharedString, StatefulInteractiveElement, Styled, div,
    prelude::*, px, rgb, rgba,
};

impl WorkCalendarApp {
    pub(crate) fn render_header_dropdowns(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let show_member = self.member_dropdown_open;
        let show_month = self.month_dropdown_open;
        let users_list = self.users.clone();
        let cur_filter = self.selected_user_filter.clone();
        let cur_months = self.month_count;

        div()
            .id("dropdown-backdrop")
            .occlude()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .on_click(cx.listener(|this, _, _, cx| {
                this.member_dropdown_open = false;
                this.month_dropdown_open = false;
                cx.notify();
            }))
            // Floating Member Filter Dropdown Menu
            .when(show_member, |el| {
                el.child(
                    div()
                        .id("member-dropdown-menu")
                        .occlude()
                        .absolute()
                        .top(px(54.0))
                        .right(px(255.0))
                        .w(px(210.0))
                        .max_h(px(360.0))
                        .p_2()
                        .rounded_xl()
                        .bg(palette.bg_modal)
                        .border_1()
                        .border_color(palette.border_strong)
                        .shadow_xl()
                        .overflow_y_scroll()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(
                            div()
                                .id("mem-opt-all")
                                .px_3()
                                .py_1p5()
                                .rounded_lg()
                                .bg(if cur_filter == "all" {
                                    palette.accent_primary_bg
                                } else {
                                    rgba(0x00000000)
                                })
                                .flex()
                                .items_center()
                                .justify_between()
                                .text_xs()
                                .font_weight(if cur_filter == "all" {
                                    gpui::FontWeight::BOLD
                                } else {
                                    gpui::FontWeight::MEDIUM
                                })
                                .text_color(if cur_filter == "all" {
                                    palette.accent_primary
                                } else {
                                    palette.text_primary
                                })
                                .cursor_pointer()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.selected_user_filter = "all".to_string();
                                    this.member_dropdown_open = false;
                                    this.refresh_all_data(cx);
                                }))
                                .child("👥 全部成员")
                                .when(cur_filter == "all", |el| el.child("✓")),
                        )
                        .children(users_list.into_iter().filter(|u| !u.is_admin()).map(|u| {
                            let uid_str = u.id.to_string();
                            let is_sel = cur_filter == uid_str;
                            let name_str = u.name().to_string();
                            let dept_str = u
                                .department_name
                                .clone()
                                .unwrap_or_else(|| "研发部".to_string());
                            div()
                                .id(SharedString::from(format!("mem-opt-{}", u.id)))
                                .px_3()
                                .py_1p5()
                                .rounded_lg()
                                .bg(if is_sel {
                                    palette.accent_primary_bg
                                } else {
                                    rgba(0x00000000)
                                })
                                .flex()
                                .items_center()
                                .justify_between()
                                .text_xs()
                                .font_weight(if is_sel {
                                    gpui::FontWeight::BOLD
                                } else {
                                    gpui::FontWeight::MEDIUM
                                })
                                .text_color(if is_sel {
                                    palette.accent_primary
                                } else {
                                    palette.text_primary
                                })
                                .cursor_pointer()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.selected_user_filter = uid_str.clone();
                                    this.member_dropdown_open = false;
                                    this.refresh_all_data(cx);
                                }))
                                .child(format!("👤 {} ({})", name_str, dept_str))
                                .when(is_sel, |el| el.child("✓"))
                        })),
                )
            })
            // Floating Month Count Dropdown Menu
            .when(show_month, |el| {
                el.child(
                    div()
                        .id("month-dropdown-menu")
                        .occlude()
                        .absolute()
                        .top(px(54.0))
                        .right(px(125.0))
                        .w(px(150.0))
                        .p_2()
                        .rounded_xl()
                        .bg(palette.bg_modal)
                        .border_1()
                        .border_color(palette.border_strong)
                        .shadow_xl()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .children([1usize, 2, 3, 4, 6, 12].into_iter().map(|m_cnt| {
                            let is_sel = cur_months == m_cnt;
                            div()
                                .id(SharedString::from(format!("month-opt-{}", m_cnt)))
                                .px_3()
                                .py_1p5()
                                .rounded_lg()
                                .bg(if is_sel {
                                    palette.accent_primary_bg
                                } else {
                                    rgba(0x00000000)
                                })
                                .flex()
                                .items_center()
                                .justify_between()
                                .text_xs()
                                .font_weight(if is_sel {
                                    gpui::FontWeight::BOLD
                                } else {
                                    gpui::FontWeight::MEDIUM
                                })
                                .text_color(if is_sel {
                                    palette.accent_primary
                                } else {
                                    palette.text_primary
                                })
                                .cursor_pointer()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.month_count = m_cnt;
                                    this.month_dropdown_open = false;
                                    this.refresh_all_data(cx);
                                }))
                                .child(format!("📅 显示 {} 个月", m_cnt))
                                .when(is_sel, |el| el.child("✓"))
                        })),
                )
            })
    }

    // ========================================================================
    // 1:1 WEB MEMO EDIT MODAL (Matches desktop_3_light_memo_modal.png)
    // ========================================================================

    pub(crate) fn render_editor_modal(
        &mut self,
        user: &User,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let is_admin = user.is_admin();
        let is_editing = self.editor_memo_id.is_some();
        let memo_id_opt = self.editor_memo_id;
        let title_focused = self.active_input == ActiveInput::EditorTitle;
        let date_focused = self.active_input == ActiveInput::EditorDate;
        let due_focused = self.active_input == ActiveInput::EditorDueTime;
        let content_focused = self.active_input == ActiveInput::EditorContent;

        let colors_row1 = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"];
        let colors_row2 = ["#ec4899", "#06b6d4", "#f97316", "#6366f1", "#64748b"];

        let today_str = today_date_str();
        let tomorrow_str = next_day_str(&today_str);
        let fri_str = friday_of_date(&self.editor_date);
        let next_mon_str = next_monday_of_date(&self.editor_date);

        div()
            .id("memo-modal-backdrop")
            .occlude()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .bg(rgba(0x0f172a88))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(760.0))
                    .p_6()
                    .rounded_2xl()
                    .bg(palette.bg_modal)
                    .border_1()
                    .border_color(palette.border_strong)
                    .shadow_xl()
                    .flex()
                    .flex_col()
                    .gap_4()
                    // Modal Header: ⊕ 添加详细备忘录 / 📝 编辑备忘录 + ✕
                    .child(
                        div()
                            .pb_3()
                            .border_b_1()
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
                                            .size(px(28.0))
                                            .rounded_full()
                                            .bg(palette.accent_primary_bg)
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .text_sm()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.accent_primary)
                                            .child(if is_editing { "📝" } else { "⊕" }),
                                    )
                                    .child(
                                        div()
                                            .text_base()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.text_primary)
                                            .child(if is_editing {
                                                format!("编辑备忘录 · {}", self.editor_owner_name)
                                            } else {
                                                "添加详细备忘录".to_string()
                                            }),
                                    ),
                            )
                            .child(
                                div()
                                    .id("memo-modal-close-x")
                                    .size(px(28.0))
                                    .rounded_lg()
                                    .bg(palette.bg_surface_alt)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.editor_open = false;
                                        this.active_input = ActiveInput::None;
                                        cx.notify();
                                    }))
                                    .child("✕"),
                            ),
                    )
                    // Manager Interactive Review / Like / Urge Bar (when editing an existing memo)
                    .when_some(memo_id_opt.filter(|_| is_admin), |el, mid| {
                        el.child(
                            div()
                                .px_3p5()
                                .py_2()
                                .rounded_xl()
                                .bg(palette.bg_surface_alt)
                                .border_1()
                                .border_color(palette.border_subtle)
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_xs()
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .text_color(palette.text_secondary)
                                        .child(format!(
                                            "👑 主管批阅互动（负责人：{}）",
                                            self.editor_owner_name
                                        )),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(
                                            div()
                                                .id("modal-mgr-review-btn")
                                                .px_3()
                                                .py_1()
                                                .rounded_lg()
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
                                                    "✓ 已审阅 (点击取消)"
                                                } else {
                                                    "✓ 标记已审阅"
                                                }),
                                        )
                                        .child(
                                            div()
                                                .id("modal-mgr-like-btn")
                                                .px_3()
                                                .py_1()
                                                .rounded_lg()
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
                                                    "👍 点赞表扬"
                                                }),
                                        )
                                        .when(!self.editor_completed, |el| {
                                            el.child(
                                                div()
                                                    .id("modal-mgr-urge-btn")
                                                    .px_3()
                                                    .py_1()
                                                    .rounded_lg()
                                                    .bg(palette.accent_rose)
                                                    .text_xs()
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(rgb(0xffffff))
                                                    .cursor_pointer()
                                                    .on_click(cx.listener(
                                                        move |this, _, _, cx| {
                                                            this.trigger_manager_urge(mid, cx);
                                                        },
                                                    ))
                                                    .child("⚡ 催办提醒"),
                                            )
                                        }),
                                ),
                        )
                    })
                    // Row 1: Title Input + [ ☑ ✓ 已完成 ] + [ ☐ 📅 纳入周计划 ]
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .child(
                                div()
                                    .id("modal-title-input")
                                    .flex_1()
                                    .h(px(42.0))
                                    .px_3p5()
                                    .rounded_xl()
                                    .bg(palette.bg_surface)
                                    .border_2()
                                    .border_color(if title_focused {
                                        palette.accent_primary
                                    } else {
                                        palette.border_subtle
                                    })
                                    .flex()
                                    .items_center()
                                    .text_sm()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(if self.editor_title.is_empty() {
                                        palette.text_muted
                                    } else {
                                        palette.text_primary
                                    })
                                    .cursor_text()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_input = ActiveInput::EditorTitle;
                                        cx.notify();
                                    }))
                                    .child(if self.editor_title.is_empty() {
                                        if title_focused {
                                            "|".to_string()
                                        } else {
                                            "输入备忘录标题...".to_string()
                                        }
                                    } else if title_focused {
                                        format!("{}|", self.editor_title)
                                    } else {
                                        self.editor_title.clone()
                                    }),
                            )
                            // Toggle Chip: ✓ 已完成
                            .child(
                                div()
                                    .id("modal-chip-completed")
                                    .h(px(42.0))
                                    .px_3p5()
                                    .rounded_xl()
                                    .bg(if self.editor_completed {
                                        palette.accent_emerald_bg
                                    } else {
                                        palette.bg_surface_alt
                                    })
                                    .border_1()
                                    .border_color(if self.editor_completed {
                                        palette.accent_emerald
                                    } else {
                                        palette.border_subtle
                                    })
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(if self.editor_completed {
                                        palette.accent_emerald
                                    } else {
                                        palette.text_secondary
                                    })
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.editor_completed = !this.editor_completed;
                                        cx.notify();
                                    }))
                                    .child(if self.editor_completed { "☑" } else { "☐" })
                                    .child("✓ 已完成"),
                            )
                            // Toggle Chip: 📅 纳入周计划
                            .child(
                                div()
                                    .id("modal-chip-weekly")
                                    .h(px(42.0))
                                    .px_3p5()
                                    .rounded_xl()
                                    .bg(if self.editor_in_weekly_plan {
                                        palette.accent_primary_bg
                                    } else {
                                        palette.bg_surface_alt
                                    })
                                    .border_1()
                                    .border_color(if self.editor_in_weekly_plan {
                                        palette.accent_primary
                                    } else {
                                        palette.border_subtle
                                    })
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(if self.editor_in_weekly_plan {
                                        palette.accent_primary
                                    } else {
                                        palette.text_secondary
                                    })
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.editor_in_weekly_plan = !this.editor_in_weekly_plan;
                                        cx.notify();
                                    }))
                                    .child(if self.editor_in_weekly_plan {
                                        "☑"
                                    } else {
                                        "☐"
                                    })
                                    .child("📅 纳入周计划"),
                            ),
                    )
                    // Row 2: 3-Column Meta Box (📅 所属日期 | 🕒 截止时间 * | 🎨 分类颜色)
                    .child(
                        div()
                            .p_3p5()
                            .rounded_xl()
                            .bg(palette.bg_surface_alt)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .grid()
                            .grid_cols(3)
                            .gap_4()
                            // Col 1: 📅 所属日期
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_1p5()
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(palette.text_secondary)
                                            .child("📅 所属日期"),
                                    )
                                    .child(
                                        div()
                                            .id("modal-date-input")
                                            .h(px(34.0))
                                            .px_3()
                                            .rounded_lg()
                                            .bg(palette.bg_surface)
                                            .border_1()
                                            .border_color(if date_focused {
                                                palette.accent_primary
                                            } else {
                                                palette.border_subtle
                                            })
                                            .flex()
                                            .items_center()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(palette.text_primary)
                                            .cursor_text()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.active_input = ActiveInput::EditorDate;
                                                cx.notify();
                                            }))
                                            .child(if date_focused {
                                                format!("{}|", self.editor_date)
                                            } else {
                                                self.editor_date.clone()
                                            }),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_1p5()
                                            .child({
                                                let t = today_str.clone();
                                                div()
                                                    .id("preset-date-today")
                                                    .px_2()
                                                    .py_0p5()
                                                    .rounded_md()
                                                    .bg(palette.bg_surface)
                                                    .border_1()
                                                    .border_color(palette.border_subtle)
                                                    .text_xs()
                                                    .text_color(palette.text_secondary)
                                                    .cursor_pointer()
                                                    .on_click(cx.listener(move |this, _, _, cx| {
                                                        this.editor_date = t.clone();
                                                        this.editor_due_time =
                                                            format!("{} 18:00", t);
                                                        cx.notify();
                                                    }))
                                                    .child("今天")
                                            })
                                            .child({
                                                let tm = tomorrow_str.clone();
                                                div()
                                                    .id("preset-date-tmr")
                                                    .px_2()
                                                    .py_0p5()
                                                    .rounded_md()
                                                    .bg(palette.bg_surface)
                                                    .border_1()
                                                    .border_color(palette.border_subtle)
                                                    .text_xs()
                                                    .text_color(palette.text_secondary)
                                                    .cursor_pointer()
                                                    .on_click(cx.listener(move |this, _, _, cx| {
                                                        this.editor_date = tm.clone();
                                                        this.editor_due_time =
                                                            format!("{} 18:00", tm);
                                                        cx.notify();
                                                    }))
                                                    .child("明天")
                                            }),
                                    ),
                            )
                            // Col 2: 🕒 截止时间 * + 4 Quick Preset Chips
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_1p5()
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(palette.text_secondary)
                                            .child("🕒 截止时间 *"),
                                    )
                                    .child(
                                        div()
                                            .id("modal-due-input")
                                            .h(px(34.0))
                                            .px_3()
                                            .rounded_lg()
                                            .bg(palette.bg_surface)
                                            .border_1()
                                            .border_color(if due_focused {
                                                palette.accent_primary
                                            } else {
                                                palette.border_subtle
                                            })
                                            .flex()
                                            .items_center()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(palette.text_primary)
                                            .cursor_text()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.active_input = ActiveInput::EditorDueTime;
                                                cx.notify();
                                            }))
                                            .child(if due_focused {
                                                format!("{}|", self.editor_due_time)
                                            } else {
                                                self.editor_due_time.clone()
                                            }),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_wrap()
                                            .gap_1()
                                            .children(
                                                [
                                                    ("due-p1", "今日 18:00", today_str),
                                                    ("due-p2", "明日 18:00", tomorrow_str),
                                                    ("due-p3", "周五 18:00", fri_str),
                                                    ("due-p4", "下周一 18:00", next_mon_str),
                                                ]
                                                .into_iter()
                                                .map(|(id, label, d_val)| {
                                                    let due_str = format!("{} 18:00", d_val);
                                                    let is_cur = self.editor_due_time == due_str;
                                                    div()
                                                        .id(id)
                                                        .px_2()
                                                        .py_0p5()
                                                        .rounded_md()
                                                        .bg(if is_cur {
                                                            palette.accent_primary_bg
                                                        } else {
                                                            palette.bg_surface
                                                        })
                                                        .border_1()
                                                        .border_color(if is_cur {
                                                            palette.accent_primary
                                                        } else {
                                                            palette.border_subtle
                                                        })
                                                        .text_xs()
                                                        .text_color(if is_cur {
                                                            palette.accent_primary
                                                        } else {
                                                            palette.text_secondary
                                                        })
                                                        .cursor_pointer()
                                                        .on_click(cx.listener(
                                                            move |this, _, _, cx| {
                                                                this.editor_due_time =
                                                                    due_str.clone();
                                                                cx.notify();
                                                            },
                                                        ))
                                                        .child(label)
                                                }),
                                            ),
                                    ),
                            )
                            // Col 3: 🎨 分类颜色 (10 colors in 2 rows of 5)
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_2()
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(palette.text_secondary)
                                            .child("🎨 分类颜色"),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .children(colors_row1.into_iter().map(|hex| {
                                                let is_sel = self.editor_color == hex;
                                                let h_str = hex.to_string();
                                                div()
                                                    .id(SharedString::from(format!(
                                                        "col-r1-{}",
                                                        hex
                                                    )))
                                                    .size(px(24.0))
                                                    .rounded_full()
                                                    .bg(parse_hex_color(hex))
                                                    .border_2()
                                                    .border_color(if is_sel {
                                                        palette.text_primary
                                                    } else {
                                                        rgba(0x00000000)
                                                    })
                                                    .cursor_pointer()
                                                    .on_click(cx.listener(
                                                        move |this, _, _, cx| {
                                                            this.editor_color = h_str.clone();
                                                            cx.notify();
                                                        },
                                                    ))
                                            })),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .children(colors_row2.into_iter().map(|hex| {
                                                let is_sel = self.editor_color == hex;
                                                let h_str = hex.to_string();
                                                div()
                                                    .id(SharedString::from(format!(
                                                        "col-r2-{}",
                                                        hex
                                                    )))
                                                    .size(px(24.0))
                                                    .rounded_full()
                                                    .bg(parse_hex_color(hex))
                                                    .border_2()
                                                    .border_color(if is_sel {
                                                        palette.text_primary
                                                    } else {
                                                        rgba(0x00000000)
                                                    })
                                                    .cursor_pointer()
                                                    .on_click(cx.listener(
                                                        move |this, _, _, cx| {
                                                            this.editor_color = h_str.clone();
                                                            cx.notify();
                                                        },
                                                    ))
                                            })),
                                    ),
                            ),
                    )
                    // Row 3: Markdown Toolbar & Quick Templates + Content Editor Box
                    .child(
                        div()
                            .rounded_xl()
                            .bg(palette.bg_surface)
                            .border_2()
                            .border_color(if content_focused {
                                palette.accent_primary
                            } else {
                                palette.border_subtle
                            })
                            .overflow_hidden()
                            .flex()
                            .flex_col()
                            // Toolbar
                            .child(
                                div()
                                    .px_3()
                                    .py_2()
                                    .bg(palette.bg_surface_alt)
                                    .border_b_1()
                                    .border_color(palette.border_subtle)
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_1()
                                            .children(
                                                [
                                                    ("md-h1", "H1", "# "),
                                                    ("md-h2", "H2", "## "),
                                                    ("md-bold", "B", "**重点** "),
                                                    ("md-list", "• 列表", "\n- "),
                                                    ("md-todo", "☑ 待办", "\n- [ ] "),
                                                ]
                                                .into_iter()
                                                .map(|(id, label, snippet)| {
                                                    div()
                                                        .id(id)
                                                        .px_2()
                                                        .py_0p5()
                                                        .rounded_md()
                                                        .bg(palette.bg_surface)
                                                        .border_1()
                                                        .border_color(palette.border_subtle)
                                                        .text_xs()
                                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                                        .text_color(palette.text_secondary)
                                                        .cursor_pointer()
                                                        .on_click(cx.listener(
                                                            move |this, _, _, cx| {
                                                                this.editor_content
                                                                    .push_str(snippet);
                                                                this.active_input =
                                                                    ActiveInput::EditorContent;
                                                                cx.notify();
                                                            },
                                                        ))
                                                        .child(label)
                                                }),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_1p5()
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .text_color(palette.text_muted)
                                                    .child("快速模板:"),
                                            )
                                            .children(
                                                [
                                                    (
                                                        "tpl-rd",
                                                        "⚡ 研发日志",
                                                        "【今日研发进展】\n1. 完成模块设计与验证：\n2. 关键测试数据记录：\n3. 明日跟进计划：",
                                                    ),
                                                    (
                                                        "tpl-meet",
                                                        "📝 会议纪要",
                                                        "【会议主题】\n• 参会人员：\n• 核心决议：\n• 待办行动项：",
                                                    ),
                                                    (
                                                        "tpl-qa",
                                                        "🔍 质检/测试",
                                                        "【测试/检验记录】\n• 测试样品与批次：\n• 实测指标与判定结果：\n• 异常处理闭环：",
                                                    ),
                                                ]
                                                .into_iter()
                                                .map(|(id, label, tpl)| {
                                                    div()
                                                        .id(id)
                                                        .px_2p5()
                                                        .py_0p5()
                                                        .rounded_full()
                                                        .bg(palette.bg_surface)
                                                        .border_1()
                                                        .border_color(palette.border_subtle)
                                                        .text_xs()
                                                        .font_weight(gpui::FontWeight::MEDIUM)
                                                        .text_color(palette.text_primary)
                                                        .cursor_pointer()
                                                        .on_click(cx.listener(
                                                            move |this, _, _, cx| {
                                                                if !this.editor_content.is_empty() {
                                                                    this.editor_content
                                                                        .push('\n');
                                                                }
                                                                this.editor_content.push_str(tpl);
                                                                this.active_input =
                                                                    ActiveInput::EditorContent;
                                                                cx.notify();
                                                            },
                                                        ))
                                                        .child(label)
                                                }),
                                            ),
                                    ),
                            )
                            // Multiline Content Area
                            .child(
                                div()
                                    .id("modal-content-input")
                                    .min_h(px(140.0))
                                    .p_3p5()
                                    .text_xs()
                                    .text_color(if self.editor_content.is_empty() {
                                        palette.text_muted
                                    } else {
                                        palette.text_primary
                                    })
                                    .cursor_text()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_input = ActiveInput::EditorContent;
                                        cx.notify();
                                    }))
                                    .child(if self.editor_content.is_empty() {
                                        if content_focused {
                                            "|".to_string()
                                        } else {
                                            "在此输入备忘录内容，支持工作进度、实验记录或上方快速模板...".to_string()
                                        }
                                    } else if content_focused {
                                        format!("{}|", self.editor_content)
                                    } else {
                                        self.editor_content.clone()
                                    }),
                            ),
                    )
                    // Modal Footer: Left (Delete + Carryover) | Right (Cancel + Save)
                    .child(
                        div()
                            .pt_2()
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
                                                .id("modal-delete-btn")
                                                .px_3p5()
                                                .py_2()
                                                .rounded_xl()
                                                .bg(palette.accent_rose_bg)
                                                .text_xs()
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(palette.accent_rose)
                                                .cursor_pointer()
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.delete_editor_memo(mid, cx);
                                                }))
                                                .child("🗑️ 删除"),
                                        )
                                    })
                                    .when(is_editing && !self.editor_completed, |el| {
                                        el.child(
                                            div()
                                                .id("modal-carryover-btn")
                                                .px_3p5()
                                                .py_2()
                                                .rounded_xl()
                                                .bg(palette.accent_primary_bg)
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
                                                        plan_kind: if this.editor_in_weekly_plan {
                                                            "weekly".to_string()
                                                        } else {
                                                            "memo".to_string()
                                                        },
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
                                                .child("↪ 一键顺延至下一天"),
                                        )
                                    }),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2p5()
                                    .child(
                                        div()
                                            .id("modal-cancel-btn")
                                            .px_5()
                                            .py_2()
                                            .rounded_xl()
                                            .bg(palette.bg_surface_alt)
                                            .border_1()
                                            .border_color(palette.border_subtle)
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(palette.text_primary)
                                            .cursor_pointer()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.editor_open = false;
                                                this.active_input = ActiveInput::None;
                                                cx.notify();
                                            }))
                                            .child("取消"),
                                    )
                                    .child(
                                        div()
                                            .id("modal-save-btn")
                                            .px_5()
                                            .py_2()
                                            .rounded_xl()
                                            .bg(palette.accent_primary)
                                            .shadow_sm()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(rgb(0xffffff))
                                            .cursor_pointer()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.save_editor_memo(cx);
                                            }))
                                            .child("保存备忘录"),
                                    ),
                            ),
                    ),
            )
    }

    // ========================================================================
    // WEEKLY SUMMARY & REPORT PREVIEW MODALS
    // ========================================================================

    pub(crate) fn render_weekly_summary_modal(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let g_focus = self.active_input == ActiveInput::WeeklyGoals;
        let d_focus = self.active_input == ActiveInput::WeeklyDeliverables;
        let a_focus = self.active_input == ActiveInput::WeeklyActual;
        let r_focus = self.active_input == ActiveInput::WeeklyRisks;

        div()
            .id("wk-summary-modal-backdrop")
            .occlude()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .bg(rgba(0x0f172a88))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(640.0))
                    .p_6()
                    .rounded_2xl()
                    .bg(palette.bg_modal)
                    .border_1()
                    .border_color(palette.border_strong)
                    .shadow_xl()
                    .flex()
                    .flex_col()
                    .gap_3p5()
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
                                    .child(format!(
                                        "🎯 本周目标与复盘 · {}",
                                        iso_week_label(&self.current_week_monday)
                                    )),
                            )
                            .child(
                                div()
                                    .id("wk-sum-auto-gen")
                                    .px_3()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.accent_primary_bg)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.accent_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.generate_weekly_summary_from_memos(cx);
                                    }))
                                    .child("✨ 从日历自动生成复盘"),
                            ),
                    )
                    .child(self.render_summary_field(
                        "wk-inp-goals",
                        "🚩 本周核心目标 (Goals)",
                        &self.weekly_goals.clone(),
                        g_focus,
                        ActiveInput::WeeklyGoals,
                        palette,
                        cx,
                    ))
                    .child(self.render_summary_field(
                        "wk-inp-deliv",
                        "📦 关键交付物与里程碑 (Deliverables)",
                        &self.weekly_deliverables.clone(),
                        d_focus,
                        ActiveInput::WeeklyDeliverables,
                        palette,
                        cx,
                    ))
                    .child(self.render_summary_field(
                        "wk-inp-actual",
                        "✅ 实际完成情况汇总 (Actual)",
                        &self.weekly_actual.clone(),
                        a_focus,
                        ActiveInput::WeeklyActual,
                        palette,
                        cx,
                    ))
                    .child(self.render_summary_field(
                        "wk-inp-risks",
                        "⚠️ 风险阻塞与下周跟进 (Risks)",
                        &self.weekly_risks.clone(),
                        r_focus,
                        ActiveInput::WeeklyRisks,
                        palette,
                        cx,
                    ))
                    .child(
                        div()
                            .pt_2()
                            .flex()
                            .justify_end()
                            .gap_2p5()
                            .child(
                                div()
                                    .id("wk-sum-cancel")
                                    .px_4()
                                    .py_2()
                                    .rounded_xl()
                                    .bg(palette.bg_surface_alt)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_secondary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.weekly_summary_modal_open = false;
                                        this.active_input = ActiveInput::None;
                                        cx.notify();
                                    }))
                                    .child("取消"),
                            )
                            .child(
                                div()
                                    .id("wk-sum-save")
                                    .px_5()
                                    .py_2()
                                    .rounded_xl()
                                    .bg(palette.accent_primary)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.save_current_weekly_summary(cx);
                                    }))
                                    .child("💾 保存目标与复盘"),
                            ),
                    ),
            )
    }

    fn render_summary_field(
        &self,
        id: &'static str,
        label: &'static str,
        val: &str,
        focused: bool,
        input_kind: ActiveInput,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .text_xs()
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_color(palette.text_secondary)
                    .child(label),
            )
            .child(
                div()
                    .id(id)
                    .min_h(px(64.0))
                    .p_2p5()
                    .rounded_xl()
                    .bg(palette.bg_surface_alt)
                    .border_2()
                    .border_color(if focused {
                        palette.accent_primary
                    } else {
                        palette.border_subtle
                    })
                    .text_xs()
                    .text_color(if val.is_empty() {
                        palette.text_muted
                    } else {
                        palette.text_primary
                    })
                    .cursor_text()
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.active_input = input_kind;
                        cx.notify();
                    }))
                    .child(if val.is_empty() {
                        if focused {
                            "|".to_string()
                        } else {
                            "点击输入内容...".to_string()
                        }
                    } else if focused {
                        format!("{}|", val)
                    } else {
                        val.to_string()
                    }),
            )
    }

    pub(crate) fn render_weekly_report_preview_modal(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let week_end = shift_days(&self.current_week_monday, 6);
        let week_memos: Vec<&Memo> = self
            .memos
            .iter()
            .filter(|m| m.date >= self.current_week_monday && m.date <= week_end)
            .collect();
        let done_cnt = week_memos.iter().filter(|m| m.completed).count();

        let mut report_md = format!(
            "# 📋 研发工作周报 · {}\n\n- **统计周期**：{} ~ {}\n- **整体进度**：共 {} 项计划，已完成 {} 项\n\n## 🎯 本周核心目标\n{}\n\n## ✅ 已完成工作事项\n",
            iso_week_label(&self.current_week_monday),
            self.current_week_monday,
            week_end,
            week_memos.len(),
            done_cnt,
            if self.weekly_goals.is_empty() {
                "按计划推进本周核心研发工作"
            } else {
                &self.weekly_goals
            }
        );

        for m in week_memos.iter().filter(|m| m.completed) {
            report_md.push_str(&format!(
                "- [x] **{}** ({} · {})\n",
                m.title,
                short_md(&m.date),
                m.owner_name
            ));
        }

        report_md.push_str("\n## ⏳ 进行中与下周跟进\n");
        for m in week_memos.iter().filter(|m| !m.completed) {
            report_md.push_str(&format!(
                "- [ ] **{}** ({} · {})\n",
                m.title,
                short_md(&m.date),
                m.owner_name
            ));
        }

        let copy_text = report_md.clone();

        div()
            .id("wk-preview-modal-backdrop")
            .occlude()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .bg(rgba(0x0f172a88))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(640.0))
                    .max_h(px(560.0))
                    .p_6()
                    .rounded_2xl()
                    .bg(palette.bg_modal)
                    .border_1()
                    .border_color(palette.border_strong)
                    .shadow_xl()
                    .flex()
                    .flex_col()
                    .gap_4()
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
                                    .child("📄 自动汇总周报预览 (Markdown 格式)"),
                            )
                            .child(
                                div()
                                    .id("wk-prev-close")
                                    .px_2p5()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.bg_surface_alt)
                                    .text_xs()
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.weekly_report_preview_open = false;
                                        cx.notify();
                                    }))
                                    .child("✕ 关闭"),
                            ),
                    )
                    .child(
                        div()
                            .id("wk-prev-scroll")
                            .flex_1()
                            .p_4()
                            .rounded_xl()
                            .bg(palette.bg_surface_alt)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .overflow_y_scroll()
                            .text_xs()
                            .text_color(palette.text_primary)
                            .child(report_md),
                    )
                    .child(
                        div()
                            .flex()
                            .justify_end()
                            .gap_2p5()
                            .child(
                                div()
                                    .id("wk-prev-copy-btn")
                                    .px_5()
                                    .py_2()
                                    .rounded_xl()
                                    .bg(palette.accent_primary)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .cursor_pointer()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        cx.write_to_clipboard(gpui::ClipboardItem::new_string(
                                            copy_text.clone(),
                                        ));
                                        this.weekly_report_preview_open = false;
                                        this.show_toast("📋 周报已复制到剪贴板！", cx);
                                    }))
                                    .child("📋 一键复制周报全文"),
                            ),
                    ),
            )
    }

    // ========================================================================
    // MANAGER TASK PUBLISH MODAL (🚀 任务发布)
    // ========================================================================

    pub(crate) fn render_task_publish_modal(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let t_focus = self.active_input == ActiveInput::TaskPubTitle;
        let d_focus = self.active_input == ActiveInput::TaskPubDate;
        let c_focus = self.active_input == ActiveInput::TaskPubContent;
        let cur_target = self.task_pub_target_uid;
        let emps: Vec<User> = self
            .users
            .iter()
            .filter(|u| !u.is_admin())
            .cloned()
            .collect();

        div()
            .id("task-pub-backdrop")
            .occlude()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .bg(rgba(0x0f172a88))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(580.0))
                    .p_6()
                    .rounded_2xl()
                    .bg(palette.bg_modal)
                    .border_1()
                    .border_color(palette.border_strong)
                    .shadow_xl()
                    .flex()
                    .flex_col()
                    .gap_4()
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
                                    .child("🚀 研发任务指派与批量发布"),
                            )
                            .child(
                                div()
                                    .id("task-pub-close")
                                    .px_2p5()
                                    .py_1()
                                    .rounded_lg()
                                    .bg(palette.bg_surface_alt)
                                    .text_xs()
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.task_pub_open = false;
                                        this.active_input = ActiveInput::None;
                                        cx.notify();
                                    }))
                                    .child("✕"),
                            ),
                    )
                    // Target Member Selection Pills
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1p5()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_secondary)
                                    .child("👥 选择指派对象"),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .gap_1p5()
                                    .child(
                                        div()
                                            .id("pub-target-all")
                                            .px_2p5()
                                            .py_1()
                                            .rounded_lg()
                                            .bg(if cur_target.is_none() {
                                                palette.accent_primary
                                            } else {
                                                palette.bg_surface_alt
                                            })
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(if cur_target.is_none() {
                                                rgb(0xffffff)
                                            } else {
                                                palette.text_primary
                                            })
                                            .cursor_pointer()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.task_pub_target_uid = None;
                                                cx.notify();
                                            }))
                                            .child("全员群发"),
                                    )
                                    .children(emps.into_iter().map(|u| {
                                        let uid = u.id;
                                        let is_sel = cur_target == Some(uid);
                                        div()
                                            .id(SharedString::from(format!("pub-t-{}", uid)))
                                            .px_2p5()
                                            .py_1()
                                            .rounded_lg()
                                            .bg(if is_sel {
                                                palette.accent_primary
                                            } else {
                                                palette.bg_surface_alt
                                            })
                                            .text_xs()
                                            .text_color(if is_sel {
                                                rgb(0xffffff)
                                            } else {
                                                palette.text_primary
                                            })
                                            .cursor_pointer()
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.task_pub_target_uid = Some(uid);
                                                cx.notify();
                                            }))
                                            .child(u.name().to_string())
                                    })),
                            ),
                    )
                    // Task Title & Date
                    .child(
                        div()
                            .flex()
                            .gap_3()
                            .child(
                                div()
                                    .flex_1()
                                    .flex()
                                    .flex_col()
                                    .gap_1()
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(palette.text_secondary)
                                            .child("📌 任务标题 *"),
                                    )
                                    .child(
                                        div()
                                            .id("pub-title-inp")
                                            .h(px(36.0))
                                            .px_3()
                                            .rounded_xl()
                                            .bg(palette.bg_surface_alt)
                                            .border_2()
                                            .border_color(if t_focus {
                                                palette.accent_primary
                                            } else {
                                                palette.border_subtle
                                            })
                                            .flex()
                                            .items_center()
                                            .text_xs()
                                            .text_color(palette.text_primary)
                                            .cursor_text()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.active_input = ActiveInput::TaskPubTitle;
                                                cx.notify();
                                            }))
                                            .child(if self.task_pub_title.is_empty() {
                                                if t_focus {
                                                    "|".to_string()
                                                } else {
                                                    "输入要下发的研发任务名称...".to_string()
                                                }
                                            } else if t_focus {
                                                format!("{}|", self.task_pub_title)
                                            } else {
                                                self.task_pub_title.clone()
                                            }),
                                    ),
                            )
                            .child(
                                div()
                                    .w(px(150.0))
                                    .flex()
                                    .flex_col()
                                    .gap_1()
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(palette.text_secondary)
                                            .child("📅 排期日期"),
                                    )
                                    .child(
                                        div()
                                            .id("pub-date-inp")
                                            .h(px(36.0))
                                            .px_3()
                                            .rounded_xl()
                                            .bg(palette.bg_surface_alt)
                                            .border_2()
                                            .border_color(if d_focus {
                                                palette.accent_primary
                                            } else {
                                                palette.border_subtle
                                            })
                                            .flex()
                                            .items_center()
                                            .text_xs()
                                            .text_color(palette.text_primary)
                                            .cursor_text()
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.active_input = ActiveInput::TaskPubDate;
                                                cx.notify();
                                            }))
                                            .child(if d_focus {
                                                format!("{}|", self.task_pub_date)
                                            } else {
                                                self.task_pub_date.clone()
                                            }),
                                    ),
                            ),
                    )
                    // Task Description
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_secondary)
                                    .child("📝 任务要求与验收标准"),
                            )
                            .child(
                                div()
                                    .id("pub-content-inp")
                                    .min_h(px(90.0))
                                    .p_3()
                                    .rounded_xl()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if c_focus {
                                        palette.accent_primary
                                    } else {
                                        palette.border_subtle
                                    })
                                    .text_xs()
                                    .text_color(palette.text_primary)
                                    .cursor_text()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.active_input = ActiveInput::TaskPubContent;
                                        cx.notify();
                                    }))
                                    .child(if self.task_pub_content.is_empty() {
                                        if c_focus {
                                            "|".to_string()
                                        } else {
                                            "输入任务交付物、时间节点与备注说明...".to_string()
                                        }
                                    } else if c_focus {
                                        format!("{}|", self.task_pub_content)
                                    } else {
                                        self.task_pub_content.clone()
                                    }),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .justify_end()
                            .gap_2p5()
                            .child(
                                div()
                                    .id("pub-submit-btn")
                                    .px_5()
                                    .py_2()
                                    .rounded_xl()
                                    .bg(palette.accent_primary)
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.publish_manager_task(cx);
                                    }))
                                    .child("🚀 立即下发任务"),
                            ),
                    ),
            )
    }

    // ========================================================================
    // REMINDER CENTER MODAL (Strictly pending/overdue/urged items)
    // ========================================================================

    pub(crate) fn render_reminder_modal(
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
            .bg(rgba(0x0f172a88))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(580.0))
                    .max_h(px(520.0))
                    .p_6()
                    .rounded_2xl()
                    .bg(palette.bg_modal)
                    .border_1()
                    .border_color(palette.border_strong)
                    .shadow_xl()
                    .flex()
                    .flex_col()
                    .gap_3p5()
                    .child(
                        div()
                            .pb_3()
                            .border_b_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .items_center()
                            .justify_between()
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
                                                .rounded_lg()
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
                                                .child("✓ 一键全部完成"),
                                        )
                                    })
                                    .child(
                                        div()
                                            .id("reminder-close-btn")
                                            .px_2p5()
                                            .py_1()
                                            .rounded_lg()
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
                                        .p_8()
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
                                    .rounded_xl()
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
                                            .items_center()
                                            .gap_2()
                                            .when(m.is_urged, |el| {
                                                el.child(
                                                    div()
                                                        .px_1p5()
                                                        .py(px(1.0))
                                                        .rounded_md()
                                                        .bg(palette.accent_rose)
                                                        .text_xs()
                                                        .font_weight(gpui::FontWeight::BOLD)
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
                                                    .text_xs()
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(palette.text_primary)
                                                    .child(m.title.clone()),
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
                                                    .px_2p5()
                                                    .py_1()
                                                    .rounded_lg()
                                                    .bg(palette.accent_primary_bg)
                                                    .text_xs()
                                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                                    .text_color(palette.accent_primary)
                                                    .cursor_pointer()
                                                    .on_click(cx.listener(move |this, _, _, cx| {
                                                        this.trigger_carryover(
                                                            m_carry.clone(),
                                                            cx,
                                                        );
                                                    }))
                                                    .child("↪ 顺延下一天"),
                                            )
                                            .child(
                                                div()
                                                    .id(SharedString::from(format!(
                                                        "rem-done-{}",
                                                        mid
                                                    )))
                                                    .px_2p5()
                                                    .py_1()
                                                    .rounded_lg()
                                                    .bg(palette.accent_emerald)
                                                    .text_xs()
                                                    .font_weight(gpui::FontWeight::BOLD)
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

    pub(crate) fn render_highlight_pager(
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
            .shadow_xl()
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
