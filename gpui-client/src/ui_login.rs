use crate::{
    ActiveInput, AuthTab, WorkCalendarApp,
    theme::{ThemeMode, ThemePalette},
};
use gpui::{
    Context, IntoElement, ParentElement, SharedString, StatefulInteractiveElement, Styled, div,
    prelude::*, px, rgb, rgba,
};

impl WorkCalendarApp {
    pub(crate) fn render_login_screen(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let is_dark = self.theme_mode == ThemeMode::Dark;

        div()
            .size_full()
            .relative()
            .bg(if is_dark {
                rgb(0x0b0f19)
            } else {
                rgb(0xeef2f6)
            })
            .flex()
            .items_center()
            .justify_center()
            // Top-right floating theme button (matches Web .server-login-theme-btn)
            .child(
                div()
                    .id("login-floating-theme-btn")
                    .absolute()
                    .top_6()
                    .right_6()
                    .px_4()
                    .py_2()
                    .rounded_full()
                    .bg(palette.bg_surface)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .shadow_md()
                    .flex()
                    .items_center()
                    .gap_2()
                    .text_xs()
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_color(palette.text_primary)
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.theme_mode = match this.theme_mode {
                            ThemeMode::Light => ThemeMode::Dark,
                            ThemeMode::Dark => ThemeMode::Light,
                        };
                        cx.notify();
                    }))
                    .child(if is_dark {
                        "☀️ 浅色模式"
                    } else {
                        "🌙 深色模式"
                    }),
            )
            // Centered 960x580 Dual-Column Card (.server-login-shell)
            .child(
                div()
                    .w(px(960.0))
                    .h(px(580.0))
                    .rounded_2xl()
                    .bg(palette.bg_surface)
                    .border_1()
                    .border_color(palette.border_subtle)
                    .shadow_xl()
                    .overflow_hidden()
                    .flex()
                    // Left Brand Column (w 400px, deep indigo #1e1b4b)
                    .child(self.render_login_left_brand_column())
                    // Right Form Column (flex_1)
                    .child(self.render_login_right_form_column(palette, cx)),
            )
    }

    fn render_login_left_brand_column(&self) -> impl IntoElement {
        div()
            .w(px(400.0))
            .h_full()
            .bg(rgb(0x1e1b4b))
            .p_8()
            .flex()
            .flex_col()
            .justify_between()
            .text_color(rgb(0xffffff))
            // Top Brand & Hero Block
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_6()
                    // Brand Row
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .child(
                                div()
                                    .size(px(44.0))
                                    .rounded_xl()
                                    .bg(rgba(0xffffff1f))
                                    .border_1()
                                    .border_color(rgba(0xffffff33))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_xl()
                                    .child("📅"),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_0p5()
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .child(
                                                div()
                                                    .text_lg()
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(rgb(0xffffff))
                                                    .child("智能工作日历"),
                                            )
                                            .child(
                                                div()
                                                    .px_2()
                                                    .py(px(1.0))
                                                    .rounded_full()
                                                    .bg(rgba(0xffffff26))
                                                    .text_xs()
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(rgb(0xe0e7ff))
                                                    .child("Server"),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(rgb(0xa5b4fc))
                                            .child("团队协作与研发工作台"),
                                    ),
                            ),
                    )
                    // Hero Copy
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_3()
                            .child(
                                div()
                                    .w(px(148.0))
                                    .px_3()
                                    .py_1()
                                    .rounded_full()
                                    .bg(rgba(0xffffff1a))
                                    .border_1()
                                    .border_color(rgba(0xffffff28))
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(
                                        div()
                                            .size(px(8.0))
                                            .rounded_full()
                                            .bg(rgb(0x34d399)),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::MEDIUM)
                                            .text_color(rgb(0xe0e7ff))
                                            .child("研发服务器已就绪"),
                                    ),
                            )
                            .child(
                                div()
                                    .text_2xl()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .child("清晰可视每一个研发排期与备忘"),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(0xc7d2fe))
                                    .child("告别单机本地存储风险，团队任务同步流转、多月份全景穿透、研发进度大屏尽在掌握。"),
                            ),
                    ),
            )
            // Middle Live Preview Card (.server-login-preview-card)
            .child(
                div()
                    .p_4()
                    .rounded_xl()
                    .bg(rgba(0xffffff14))
                    .border_1()
                    .border_color(rgba(0xffffff24))
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
                                            .size(px(8.0))
                                            .rounded_full()
                                            .bg(rgb(0x34d399)),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(rgb(0xffffff))
                                            .child("9月研发重点跟进"),
                                    ),
                            )
                            .child(
                                div()
                                    .px_2()
                                    .py(px(2.0))
                                    .rounded_md()
                                    .bg(rgba(0x10b98133))
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0x6ee7b7))
                                    .child("进行中"),
                            ),
                    )
                    .child(
                        div()
                            .p_3()
                            .rounded_lg()
                            .bg(rgba(0x00000038))
                            .flex()
                            .flex_col()
                            .gap_2()
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
                                            .gap_2()
                                            .text_color(rgb(0xe2e8f0))
                                            .child(
                                                div()
                                                    .text_color(rgb(0x34d399))
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .child("✓"),
                                            )
                                            .child("SolidWorks 零件结构优化"),
                                    )
                                    .child(
                                        div()
                                            .text_color(rgb(0x94a3b8))
                                            .child("已完成"),
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
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .text_color(rgb(0xe2e8f0))
                                            .child(
                                                div()
                                                    .text_color(rgb(0xfbbf24))
                                                    .child("⏳"),
                                            )
                                            .child("PCB 驱动电路耐压测试"),
                                    )
                                    .child(
                                        div()
                                            .text_color(rgb(0xfcd34d))
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .child("今日截止"),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .pt_1()
                            .flex()
                            .items_center()
                            .justify_between()
                            .text_xs()
                            .child(
                                div()
                                    .text_color(rgb(0xc7d2fe))
                                    .child("研发团队完成率"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(rgb(0xffffff))
                                    .child("78.5%"),
                            ),
                    ),
            )
            // Bottom Feature Strip
            .child(
                div()
                    .pt_3()
                    .border_t_1()
                    .border_color(rgba(0xffffff1f))
                    .flex()
                    .items_center()
                    .justify_between()
                    .text_xs()
                    .text_color(rgb(0xa5b4fc))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1p5()
                            .child("🗄️")
                            .child("PostgreSQL 集中化持久存储"),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1p5()
                            .child("🛡️")
                            .child("企业级加密保护"),
                    ),
            )
    }

    fn render_login_right_form_column(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let auth_tab = self.auth_tab;

        div()
            .flex_1()
            .h_full()
            .p_8()
            .bg(palette.bg_surface)
            .flex()
            .flex_col()
            .justify_between()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    // Top status bar
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_secondary)
                                    .child("智能网页工作日历备忘录 · v2.0"),
                            )
                            .child(
                                div()
                                    .px_2p5()
                                    .py_0p5()
                                    .rounded_full()
                                    .bg(palette.accent_emerald_bg)
                                    .flex()
                                    .items_center()
                                    .gap_1p5()
                                    .child(
                                        div()
                                            .size(px(6.0))
                                            .rounded_full()
                                            .bg(palette.accent_emerald),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(palette.accent_emerald)
                                            .child("在线 (8090)"),
                                    ),
                            ),
                    )
                    // Title & Subtitle
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_2xl()
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(palette.text_primary)
                                    .child(match auth_tab {
                                        AuthTab::Login => "欢迎回来",
                                        AuthTab::Register => "新成员注册",
                                        AuthTab::Password => "修改登录密码",
                                    }),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child(match auth_tab {
                                        AuthTab::Login => {
                                            "请登录您的工作账号，查看排期与备忘录"
                                        }
                                        AuthTab::Register => {
                                            "创建您的研发团队工作台账号，立即加入协作"
                                        }
                                        AuthTab::Password => {
                                            "验证原密码并设置新的安全登录密码"
                                        }
                                    }),
                            ),
                    )
                    // 3 Segmented Auth Tabs (.server-auth-tabs)
                    .child(
                        div()
                            .p_1()
                            .rounded_xl()
                            .bg(palette.bg_pill)
                            .border_1()
                            .border_color(palette.border_subtle)
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(self.render_auth_tab_btn(
                                "auth-tab-login",
                                "账号登录",
                                AuthTab::Login,
                                palette,
                                cx,
                            ))
                            .child(self.render_auth_tab_btn(
                                "auth-tab-register",
                                "新成员注册",
                                AuthTab::Register,
                                palette,
                                cx,
                            ))
                            .child(self.render_auth_tab_btn(
                                "auth-tab-pwd",
                                "修改密码",
                                AuthTab::Password,
                                palette,
                                cx,
                            )),
                    )
                    // Error or Success Banner
                    .when_some(self.login_error.clone(), |el, err| {
                        el.child(
                            div()
                                .px_3()
                                .py_2()
                                .rounded_lg()
                                .bg(palette.accent_rose_bg)
                                .border_1()
                                .border_color(palette.accent_rose)
                                .text_xs()
                                .font_weight(gpui::FontWeight::MEDIUM)
                                .text_color(palette.accent_rose)
                                .child(format!("⚠️ {}", err)),
                        )
                    })
                    .when_some(self.login_success.clone(), |el, msg| {
                        el.child(
                            div()
                                .px_3()
                                .py_2()
                                .rounded_lg()
                                .bg(palette.accent_emerald_bg)
                                .border_1()
                                .border_color(palette.accent_emerald)
                                .text_xs()
                                .font_weight(gpui::FontWeight::MEDIUM)
                                .text_color(palette.accent_emerald)
                                .child(format!("✅ {}", msg)),
                        )
                    })
                    // Active Form Panel
                    .child(match auth_tab {
                        AuthTab::Login => {
                            self.render_login_panel(palette, cx).into_any_element()
                        }
                        AuthTab::Register => {
                            self.render_register_panel(palette, cx).into_any_element()
                        }
                        AuthTab::Password => {
                            self.render_password_panel(palette, cx).into_any_element()
                        }
                    }),
            )
            // Bottom Footer
            .child(
                div()
                    .pt_3()
                    .border_t_1()
                    .border_color(palette.border_subtle)
                    .flex()
                    .items_center()
                    .justify_between()
                    .text_xs()
                    .text_color(palette.text_muted)
                    .child("© 2026 智能工作日历备忘录系统")
                    .child("企业内网安全连接"),
            )
    }

    fn render_auth_tab_btn(
        &self,
        id: &'static str,
        label: &'static str,
        tab: AuthTab,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let active = self.auth_tab == tab;
        div()
            .id(id)
            .flex_1()
            .py_1p5()
            .rounded_lg()
            .bg(if active {
                palette.bg_surface
            } else {
                rgba(0x00000000)
            })
            .when(active, |el| el.shadow_sm())
            .flex()
            .items_center()
            .justify_center()
            .text_xs()
            .font_weight(if active {
                gpui::FontWeight::BOLD
            } else {
                gpui::FontWeight::MEDIUM
            })
            .text_color(if active {
                palette.accent_primary
            } else {
                palette.text_secondary
            })
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, _, cx| {
                this.auth_tab = tab;
                this.login_error = None;
                this.login_success = None;
                this.active_input = ActiveInput::None;
                cx.notify();
            }))
            .child(label)
    }

    fn render_login_panel(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let user_focused = self.active_input == ActiveInput::LoginUsername;
        let pass_focused = self.active_input == ActiveInput::LoginPassword;
        let pass_display = if self.show_password {
            self.login_password.clone()
        } else {
            "•".repeat(self.login_password.chars().count())
        };

        let quick_accounts = [
            ("admin", "👑 管理端(admin)"),
            ("邹木生", "邹木生"),
            ("蔡涛", "蔡涛"),
            ("孔致镔", "孔致镔"),
        ];

        div()
            .flex()
            .flex_col()
            .gap_3p5()
            // Username Field
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1p5()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_primary)
                                    .child("用户名 / 真实姓名"),
                            )
                            // Subtle quick account chips for 1-click testing
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .children(quick_accounts.into_iter().map(|(uname, label)| {
                                        let u_str = uname.to_string();
                                        let is_cur = self.login_username == uname;
                                        div()
                                            .id(SharedString::from(format!("quick-acc-{}", uname)))
                                            .px_2()
                                            .py(px(1.0))
                                            .rounded_md()
                                            .bg(if is_cur {
                                                palette.accent_primary_bg
                                            } else {
                                                palette.bg_pill
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
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.login_username = u_str.clone();
                                                this.login_password = "0000".to_string();
                                                cx.notify();
                                            }))
                                            .child(label)
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .id("login-username-input")
                            .h(px(42.0))
                            .px_3()
                            .rounded_xl()
                            .bg(palette.bg_surface_alt)
                            .border_2()
                            .border_color(if user_focused {
                                palette.accent_primary
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .items_center()
                            .gap_2p5()
                            .cursor_text()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_input = ActiveInput::LoginUsername;
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(palette.text_muted)
                                    .child("👤"),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .text_sm()
                                    .text_color(if self.login_username.is_empty() {
                                        palette.text_muted
                                    } else {
                                        palette.text_primary
                                    })
                                    .child(if self.login_username.is_empty() {
                                        if user_focused {
                                            "|".to_string()
                                        } else {
                                            "请输入您的姓名或工号".to_string()
                                        }
                                    } else if user_focused {
                                        format!("{}|", self.login_username)
                                    } else {
                                        self.login_username.clone()
                                    }),
                            ),
                    ),
            )
            // Password Field
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1p5()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(palette.text_primary)
                                    .child("登录密码"),
                            )
                            .child(
                                div()
                                    .id("forgot-pwd-link")
                                    .text_xs()
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .text_color(palette.accent_primary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.pwd_username = this.login_username.clone();
                                        this.auth_tab = AuthTab::Password;
                                        this.login_error = None;
                                        cx.notify();
                                    }))
                                    .child("忘记密码?"),
                            ),
                    )
                    .child(
                        div()
                            .id("login-password-input")
                            .h(px(42.0))
                            .px_3()
                            .rounded_xl()
                            .bg(palette.bg_surface_alt)
                            .border_2()
                            .border_color(if pass_focused {
                                palette.accent_primary
                            } else {
                                palette.border_subtle
                            })
                            .flex()
                            .items_center()
                            .justify_between()
                            .cursor_text()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_input = ActiveInput::LoginPassword;
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2p5()
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(palette.text_muted)
                                            .child("🔒"),
                                    )
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(if self.login_password.is_empty() {
                                                palette.text_muted
                                            } else {
                                                palette.text_primary
                                            })
                                            .child(if self.login_password.is_empty() {
                                                if pass_focused {
                                                    "|".to_string()
                                                } else {
                                                    "请输入登录密码".to_string()
                                                }
                                            } else if pass_focused {
                                                format!("{}|", pass_display)
                                            } else {
                                                pass_display
                                            }),
                                    ),
                            )
                            .child(
                                div()
                                    .id("toggle-pwd-vis")
                                    .px_2()
                                    .py_1()
                                    .rounded_md()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        cx.stop_propagation();
                                        this.show_password = !this.show_password;
                                        cx.notify();
                                    }))
                                    .child(if self.show_password { "🙈" } else { "👁️" }),
                            ),
                    ),
            )
            // Remember Credentials Row
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .id("login-remember-toggle")
                            .flex()
                            .items_center()
                            .gap_2()
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.login_remember = !this.login_remember;
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .size(px(16.0))
                                    .rounded_sm()
                                    .bg(if self.login_remember {
                                        palette.accent_primary
                                    } else {
                                        palette.bg_surface_alt
                                    })
                                    .border_1()
                                    .border_color(if self.login_remember {
                                        palette.accent_primary
                                    } else {
                                        palette.border_strong
                                    })
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_xs()
                                    .text_color(rgb(0xffffff))
                                    .child(if self.login_remember { "✓" } else { "" }),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(palette.text_secondary)
                                    .child("在此设备上保存账号密码"),
                            ),
                    ),
            )
            // Primary Submit Button (.server-login-submit)
            .child(
                div()
                    .id("login-submit-btn")
                    .mt_1()
                    .h(px(44.0))
                    .rounded_xl()
                    .bg(palette.accent_primary)
                    .shadow_md()
                    .flex()
                    .items_center()
                    .justify_center()
                    .gap_2()
                    .text_sm()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(rgb(0xffffff))
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.perform_login(cx);
                    }))
                    .child(if self.is_loading {
                        "正在连接工作台..."
                    } else {
                        "登 录 工 作 台  →"
                    }),
            )
    }

    fn render_register_panel(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let u_focus = self.active_input == ActiveInput::RegUsername;
        let j_focus = self.active_input == ActiveInput::RegJobTitle;
        let p_focus = self.active_input == ActiveInput::RegPassword;
        let pc_focus = self.active_input == ActiveInput::RegPasswordConfirm;

        div()
            .flex()
            .flex_col()
            .gap_3()
            // Row 1: Username + Job Title
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
                                    .text_color(palette.text_primary)
                                    .child("登录账号 / 姓名 *"),
                            )
                            .child(
                                div()
                                    .id("reg-username-input")
                                    .h(px(38.0))
                                    .px_3()
                                    .rounded_xl()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if u_focus {
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
                                        this.active_input = ActiveInput::RegUsername;
                                        cx.notify();
                                    }))
                                    .child(if self.reg_username.is_empty() {
                                        if u_focus {
                                            "|".to_string()
                                        } else {
                                            "例如：张工 / zhangsan".to_string()
                                        }
                                    } else if u_focus {
                                        format!("{}|", self.reg_username)
                                    } else {
                                        self.reg_username.clone()
                                    }),
                            ),
                    )
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
                                    .text_color(palette.text_primary)
                                    .child("岗位名称"),
                            )
                            .child(
                                div()
                                    .id("reg-job-input")
                                    .h(px(38.0))
                                    .px_3()
                                    .rounded_xl()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if j_focus {
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
                                        this.active_input = ActiveInput::RegJobTitle;
                                        cx.notify();
                                    }))
                                    .child(if self.reg_job_title.is_empty() {
                                        if j_focus {
                                            "|".to_string()
                                        } else {
                                            "例如：硬件工程师".to_string()
                                        }
                                    } else if j_focus {
                                        format!("{}|", self.reg_job_title)
                                    } else {
                                        self.reg_job_title.clone()
                                    }),
                            ),
                    ),
            )
            // Row 2: Password + Confirm Password
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
                                    .text_color(palette.text_primary)
                                    .child("设置密码 *"),
                            )
                            .child(
                                div()
                                    .id("reg-pwd-input")
                                    .h(px(38.0))
                                    .px_3()
                                    .rounded_xl()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if p_focus {
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
                                        this.active_input = ActiveInput::RegPassword;
                                        cx.notify();
                                    }))
                                    .child(if self.reg_password.is_empty() {
                                        if p_focus {
                                            "|".to_string()
                                        } else {
                                            "至少 4 位密码".to_string()
                                        }
                                    } else if p_focus {
                                        format!(
                                            "{}|",
                                            "•".repeat(self.reg_password.chars().count())
                                        )
                                    } else {
                                        "•".repeat(self.reg_password.chars().count())
                                    }),
                            ),
                    )
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
                                    .text_color(palette.text_primary)
                                    .child("确认密码 *"),
                            )
                            .child(
                                div()
                                    .id("reg-pwd-confirm-input")
                                    .h(px(38.0))
                                    .px_3()
                                    .rounded_xl()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if pc_focus {
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
                                        this.active_input = ActiveInput::RegPasswordConfirm;
                                        cx.notify();
                                    }))
                                    .child(if self.reg_password_confirm.is_empty() {
                                        if pc_focus {
                                            "|".to_string()
                                        } else {
                                            "再次输入密码".to_string()
                                        }
                                    } else if pc_focus {
                                        format!(
                                            "{}|",
                                            "•".repeat(self.reg_password_confirm.chars().count())
                                        )
                                    } else {
                                        "•".repeat(self.reg_password_confirm.chars().count())
                                    }),
                            ),
                    ),
            )
            .child(
                div()
                    .id("reg-submit-btn")
                    .mt_2()
                    .h(px(42.0))
                    .rounded_xl()
                    .bg(palette.accent_primary)
                    .shadow_md()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_sm()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(rgb(0xffffff))
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.perform_register(cx);
                    }))
                    .child("立 即 注 册 并 登 录  →"),
            )
    }

    fn render_password_panel(
        &mut self,
        palette: ThemePalette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let u_focus = self.active_input == ActiveInput::PwdUsername;
        let o_focus = self.active_input == ActiveInput::PwdOld;
        let n_focus = self.active_input == ActiveInput::PwdNew;

        div()
            .flex()
            .flex_col()
            .gap_2p5()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .text_xs()
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .text_color(palette.text_primary)
                            .child("账号 / 姓名"),
                    )
                    .child(
                        div()
                            .id("pwd-username-input")
                            .h(px(36.0))
                            .px_3()
                            .rounded_xl()
                            .bg(palette.bg_surface_alt)
                            .border_2()
                            .border_color(if u_focus {
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
                                this.active_input = ActiveInput::PwdUsername;
                                cx.notify();
                            }))
                            .child(if self.pwd_username.is_empty() {
                                if u_focus {
                                    "|".to_string()
                                } else {
                                    "请输入要修改密码的账号".to_string()
                                }
                            } else if u_focus {
                                format!("{}|", self.pwd_username)
                            } else {
                                self.pwd_username.clone()
                            }),
                    ),
            )
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
                                    .text_color(palette.text_primary)
                                    .child("原密码"),
                            )
                            .child(
                                div()
                                    .id("pwd-old-input")
                                    .h(px(36.0))
                                    .px_3()
                                    .rounded_xl()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if o_focus {
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
                                        this.active_input = ActiveInput::PwdOld;
                                        cx.notify();
                                    }))
                                    .child(if self.pwd_old.is_empty() {
                                        if o_focus {
                                            "|".to_string()
                                        } else {
                                            "输入当前密码".to_string()
                                        }
                                    } else if o_focus {
                                        format!("{}|", "•".repeat(self.pwd_old.chars().count()))
                                    } else {
                                        "•".repeat(self.pwd_old.chars().count())
                                    }),
                            ),
                    )
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
                                    .text_color(palette.text_primary)
                                    .child("新密码 (至少4位)"),
                            )
                            .child(
                                div()
                                    .id("pwd-new-input")
                                    .h(px(36.0))
                                    .px_3()
                                    .rounded_xl()
                                    .bg(palette.bg_surface_alt)
                                    .border_2()
                                    .border_color(if n_focus {
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
                                        this.active_input = ActiveInput::PwdNew;
                                        cx.notify();
                                    }))
                                    .child(if self.pwd_new.is_empty() {
                                        if n_focus {
                                            "|".to_string()
                                        } else {
                                            "输入新密码".to_string()
                                        }
                                    } else if n_focus {
                                        format!("{}|", "•".repeat(self.pwd_new.chars().count()))
                                    } else {
                                        "•".repeat(self.pwd_new.chars().count())
                                    }),
                            ),
                    ),
            )
            .child(
                div()
                    .id("pwd-submit-btn")
                    .mt_2()
                    .h(px(42.0))
                    .rounded_xl()
                    .bg(palette.accent_primary)
                    .shadow_md()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_sm()
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(rgb(0xffffff))
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.perform_change_password(cx);
                    }))
                    .child("确 认 修 改 密 码  →"),
            )
    }
}
