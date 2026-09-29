use chrono::{Datelike, Duration, Local, NaiveDate};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: i64,
    pub username: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub job_title: Option<String>,
    #[serde(default)]
    pub department_id: Option<i64>,
    #[serde(default)]
    pub department_name: Option<String>,
}

impl User {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }

    pub fn name(&self) -> &str {
        if !self.display_name.is_empty() {
            &self.display_name
        } else {
            &self.username
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memo {
    pub id: i64,
    pub owner_id: i64,
    #[serde(default)]
    pub owner_name: String,
    #[serde(default)]
    pub department_id: Option<i64>,
    #[serde(default)]
    pub department_name: Option<String>,
    pub date: String,
    pub title: String,
    #[serde(default)]
    pub content_preview: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default = "default_memo_color")]
    pub color: String,
    #[serde(default)]
    pub completed: bool,
    #[serde(default = "default_plan_kind")]
    pub plan_kind: String,
    #[serde(default)]
    pub rollover_from_id: Option<i64>,
    #[serde(default)]
    pub rollover_to_id: Option<i64>,
    #[serde(default)]
    pub rollover_reason: String,
    #[serde(default)]
    pub due_time: Option<String>,
    #[serde(default)]
    pub is_urged: bool,
    #[serde(default)]
    pub is_reviewed: bool,
    #[serde(default)]
    pub is_liked: bool,
}

fn default_memo_color() -> String {
    "#3b82f6".to_string()
}

fn default_plan_kind() -> String {
    "memo".to_string()
}

impl Memo {
    pub fn body_text(&self) -> &str {
        if let Some(c) = &self.content {
            if !c.is_empty() {
                return c;
            }
        }
        &self.content_preview
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub id: i64,
    pub memo_id: Option<i64>,
    #[serde(rename = "type")]
    pub notif_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub sender_name: String,
    #[serde(default)]
    pub is_read: bool,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WeeklySummary {
    #[serde(default)]
    pub owner_id: i64,
    #[serde(default)]
    pub week_start: String,
    #[serde(default)]
    pub goals: String,
    #[serde(default)]
    pub deliverables: String,
    #[serde(default)]
    pub actual: String,
    #[serde(default)]
    pub risks: String,
}

#[derive(Debug, Clone)]
pub struct DayCell {
    pub date_str: String,
    pub day_num: u32,
    pub is_current_month: bool,
    pub is_today: bool,
}

pub fn today_date_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub fn current_year_month() -> (i32, u32) {
    let now = Local::now();
    (now.year(), now.month())
}

pub fn shift_month(year: i32, month: u32, delta: i32) -> (i32, u32) {
    let total = year * 12 + (month as i32 - 1) + delta;
    let new_year = total.div_euclid(12);
    let new_month = (total.rem_euclid(12) + 1) as u32;
    (new_year, new_month)
}

pub fn month_key(year: i32, month: u32) -> String {
    format!("{:04}-{:02}", year, month)
}

pub fn days_in_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = shift_month(year, month, 1);
    let first_next = NaiveDate::from_ymd_opt(ny, nm, 1).unwrap();
    let first_curr = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    (first_next - first_curr).num_days() as u32
}

pub fn build_month_cells(year: i32, month: u32, today_str: &str) -> Vec<DayCell> {
    let first_day = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    let leading = first_day.weekday().num_days_from_sunday();
    let total_days = days_in_month(year, month);

    let mut cells = Vec::with_capacity(42);

    for i in (1..=leading).rev() {
        let d = first_day - Duration::days(i as i64);
        let ds = d.format("%Y-%m-%d").to_string();
        cells.push(DayCell {
            is_today: ds == today_str,
            date_str: ds,
            day_num: d.day(),
            is_current_month: false,
        });
    }

    for day in 1..=total_days {
        let d = NaiveDate::from_ymd_opt(year, month, day).unwrap();
        let ds = d.format("%Y-%m-%d").to_string();
        cells.push(DayCell {
            is_today: ds == today_str,
            date_str: ds,
            day_num: day,
            is_current_month: true,
        });
    }

    // 仅当月跨 6 周时才补齐 42 格，否则使用 35 格（5 行），将纵向高度全留给当月卡片
    let target_count = if cells.len() <= 35 { 35 } else { 42 };
    let last_day = NaiveDate::from_ymd_opt(year, month, total_days).unwrap();
    let mut next_offset = 1i64;
    while cells.len() < target_count {
        let d = last_day + Duration::days(next_offset);
        let ds = d.format("%Y-%m-%d").to_string();
        cells.push(DayCell {
            is_today: ds == today_str,
            date_str: ds,
            day_num: d.day(),
            is_current_month: false,
        });
        next_offset += 1;
    }

    cells
}

pub fn next_day_str(date_str: &str) -> String {
    if let Ok(d) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        (d + Duration::days(1)).format("%Y-%m-%d").to_string()
    } else {
        today_date_str()
    }
}

pub fn monday_of_date(date_str: &str) -> String {
    let d = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .unwrap_or_else(|_| Local::now().date_naive());
    let offset = d.weekday().num_days_from_monday() as i64;
    (d - Duration::days(offset)).format("%Y-%m-%d").to_string()
}

pub fn shift_days(date_str: &str, days: i64) -> String {
    let d = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .unwrap_or_else(|_| Local::now().date_naive());
    (d + Duration::days(days)).format("%Y-%m-%d").to_string()
}
