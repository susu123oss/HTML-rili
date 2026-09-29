use gpui::{Rgba, rgb, rgba};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThemeMode {
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug)]
#[allow(dead_code)]
pub struct ThemePalette {
    pub mode: ThemeMode,
    pub bg_app: Rgba,
    pub bg_sidebar: Rgba,
    pub bg_surface: Rgba,
    pub bg_surface_alt: Rgba,
    pub bg_cell: Rgba,
    pub bg_cell_other: Rgba,
    pub bg_cell_today: Rgba,
    pub bg_modal: Rgba,
    pub border_subtle: Rgba,
    pub border_strong: Rgba,
    pub text_primary: Rgba,
    pub text_secondary: Rgba,
    pub text_muted: Rgba,
    pub accent_primary: Rgba,
    pub accent_primary_bg: Rgba,
    pub accent_emerald: Rgba,
    pub accent_emerald_bg: Rgba,
    pub accent_amber: Rgba,
    pub accent_amber_bg: Rgba,
    pub accent_rose: Rgba,
    pub accent_rose_bg: Rgba,
    pub accent_purple: Rgba,
    pub accent_purple_bg: Rgba,
}

impl ThemePalette {
    pub fn for_mode(mode: ThemeMode) -> Self {
        match mode {
            ThemeMode::Light => Self {
                mode,
                bg_app: rgb(0xf4f6fb),
                bg_sidebar: rgb(0xffffff),
                bg_surface: rgb(0xffffff),
                bg_surface_alt: rgb(0xf8fafc),
                bg_cell: rgb(0xffffff),
                bg_cell_other: rgb(0xf1f5f9),
                bg_cell_today: rgb(0xeff6ff),
                bg_modal: rgb(0xffffff),
                border_subtle: rgb(0xe2e8f0),
                border_strong: rgb(0xcbd5e1),
                text_primary: rgb(0x0f172a),
                text_secondary: rgb(0x475569),
                text_muted: rgb(0x94a3b8),
                accent_primary: rgb(0x4f46e5),
                accent_primary_bg: rgba(0x4f46e51a),
                accent_emerald: rgb(0x10b981),
                accent_emerald_bg: rgba(0x10b98122),
                accent_amber: rgb(0xf59e0b),
                accent_amber_bg: rgba(0xf59e0b24),
                accent_rose: rgb(0xf43f5e),
                accent_rose_bg: rgba(0xf43f5e22),
                accent_purple: rgb(0x7c3aed),
                accent_purple_bg: rgba(0x7c3aed20),
            },
            ThemeMode::Dark => Self {
                mode,
                bg_app: rgb(0x0b0f19),
                bg_sidebar: rgb(0x111827),
                bg_surface: rgb(0x151e30),
                bg_surface_alt: rgb(0x1e293b),
                bg_cell: rgb(0x162032),
                bg_cell_other: rgb(0x0f172a),
                bg_cell_today: rgb(0x1e2b4d),
                bg_modal: rgb(0x182235),
                border_subtle: rgb(0x26334d),
                border_strong: rgb(0x3b4d71),
                text_primary: rgb(0xf8fafc),
                text_secondary: rgb(0x94a3b8),
                text_muted: rgb(0x64748b),
                accent_primary: rgb(0x6366f1),
                accent_primary_bg: rgba(0x6366f133),
                accent_emerald: rgb(0x10b981),
                accent_emerald_bg: rgba(0x10b98133),
                accent_amber: rgb(0xf59e0b),
                accent_amber_bg: rgba(0xf59e0b33),
                accent_rose: rgb(0xf43f5e),
                accent_rose_bg: rgba(0xf43f5e33),
                accent_purple: rgb(0xa855f7),
                accent_purple_bg: rgba(0xa855f733),
            },
        }
    }
}
