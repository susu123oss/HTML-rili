use crate::models::{next_day_str, Memo, NotificationItem, User, WeeklySummary};
use anyhow::{anyhow, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct ApiClient {
    pub base_url: String,
    pub token: Option<String>,
}

#[derive(Deserialize)]
struct LoginResponse {
    token: String,
    user: User,
}

#[derive(Deserialize)]
struct UsersResponse {
    #[serde(default)]
    users: Vec<User>,
}

#[derive(Deserialize)]
struct MemosResponse {
    #[serde(default)]
    memos: Vec<Memo>,
}

#[derive(Deserialize)]
struct SingleMemoResponse {
    memo: Memo,
}

#[derive(Deserialize)]
struct NotificationsResponse {
    #[serde(default)]
    notifications: Vec<NotificationItem>,
}

#[derive(Deserialize)]
struct ReactResponse {
    #[serde(rename = "isReviewed", default)]
    is_reviewed: bool,
    #[serde(rename = "isLiked", default)]
    is_liked: bool,
}

#[derive(Deserialize)]
struct WeeklySummariesResponse {
    #[serde(default)]
    summaries: Vec<WeeklySummary>,
}

#[derive(Deserialize)]
struct SingleWeeklySummaryResponse {
    summary: WeeklySummary,
}

impl ApiClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            token: None,
        }
    }

    pub fn default_production() -> Self {
        let url = std::env::var("WORK_CALENDAR_API_URL")
            .unwrap_or_else(|_| "http://45.205.25.3:8090/api".to_string());
        Self::new(url)
    }

    fn agent(&self) -> ureq::Agent {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(6))
            .timeout(Duration::from_secs(12))
            .build()
    }

    fn auth_header(&self) -> Result<String> {
        let tok = self
            .token
            .as_ref()
            .ok_or_else(|| anyhow!("尚未登录，缺少鉴权 Token"))?;
        Ok(format!("Bearer {}", tok))
    }

    pub fn login(&self, username: &str, password: &str) -> Result<(String, User)> {
        let url = format!("{}/auth/login", self.base_url);
        let resp = self
            .agent()
            .post(&url)
            .set("Content-Type", "application/json")
            .send_json(json!({
                "username": username,
                "password": password,
            }));

        match resp {
            Ok(r) => {
                let data: LoginResponse = r.into_json()?;
                Ok((data.token, data.user))
            }
            Err(ureq::Error::Status(code, r)) => {
                let body: Value = r.into_json().unwrap_or_else(|_| json!({}));
                let msg = body
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("登录失败");
                Err(anyhow!("HTTP {}: {}", code, msg))
            }
            Err(e) => Err(anyhow!("网络请求异常: {}", e)),
        }
    }

    pub fn fetch_users(&self) -> Result<Vec<User>> {
        let url = format!("{}/users", self.base_url);
        let resp = self
            .agent()
            .get(&url)
            .set("Authorization", &self.auth_header()?)
            .call()?;
        let data: UsersResponse = resp.into_json()?;
        Ok(data.users)
    }

    pub fn fetch_memos(
        &self,
        start_month: &str,
        months: usize,
        user_id: &str,
    ) -> Result<Vec<Memo>> {
        let mut url = format!(
            "{}/memos?startMonth={}&months={}&includeContent=1",
            self.base_url, start_month, months
        );
        if !user_id.is_empty() && user_id != "all" {
            url.push_str(&format!("&userId={}", user_id));
        }
        let resp = self
            .agent()
            .get(&url)
            .set("Authorization", &self.auth_header()?)
            .call()?;
        let data: MemosResponse = resp.into_json()?;
        Ok(data.memos)
    }

    pub fn fetch_reminders(&self) -> Result<Vec<Memo>> {
        let url = format!("{}/memos/reminders", self.base_url);
        let resp = self
            .agent()
            .get(&url)
            .set("Authorization", &self.auth_header()?)
            .call()?;
        let data: MemosResponse = resp.into_json()?;
        Ok(data.memos)
    }

    pub fn fetch_notifications(&self) -> Result<Vec<NotificationItem>> {
        let url = format!("{}/notifications", self.base_url);
        let resp = self
            .agent()
            .get(&url)
            .set("Authorization", &self.auth_header()?)
            .call()?;
        let data: NotificationsResponse = resp.into_json()?;
        Ok(data.notifications)
    }

    pub fn mark_notifications_read(&self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let url = format!("{}/notifications/read", self.base_url);
        self.agent()
            .post(&url)
            .set("Authorization", &self.auth_header()?)
            .set("Content-Type", "application/json")
            .send_json(json!({ "ids": ids }))?;
        Ok(())
    }

    pub fn react_memo(&self, memo_id: i64, action: &str) -> Result<(bool, bool)> {
        let url = format!("{}/memos/{}/react", self.base_url, memo_id);
        let resp = self
            .agent()
            .post(&url)
            .set("Authorization", &self.auth_header()?)
            .set("Content-Type", "application/json")
            .send_json(json!({ "action": action }))?;
        let data: ReactResponse = resp.into_json()?;
        Ok((data.is_reviewed, data.is_liked))
    }

    pub fn urge_memo(&self, memo_id: i64) -> Result<()> {
        let url = format!("{}/memos/urge", self.base_url);
        self.agent()
            .post(&url)
            .set("Authorization", &self.auth_header()?)
            .set("Content-Type", "application/json")
            .send_json(json!({ "memoIds": [memo_id] }))?;
        Ok(())
    }

    pub fn create_memo(
        &self,
        owner_id: Option<i64>,
        date: &str,
        title: &str,
        content: &str,
        color: &str,
        completed: bool,
    ) -> Result<Memo> {
        let url = format!("{}/memos", self.base_url);
        let mut payload = json!({
            "date": date,
            "title": title,
            "content": content,
            "color": color,
            "completed": completed,
            "dueTime": format!("{}T18:00:00", date),
        });
        if let Some(uid) = owner_id {
            payload["ownerId"] = json!(uid);
        }
        let resp = self
            .agent()
            .post(&url)
            .set("Authorization", &self.auth_header()?)
            .set("Content-Type", "application/json")
            .send_json(payload)?;
        let data: SingleMemoResponse = resp.into_json()?;
        Ok(data.memo)
    }

    pub fn update_memo(
        &self,
        memo_id: i64,
        title: Option<&str>,
        content: Option<&str>,
        color: Option<&str>,
        completed: Option<bool>,
    ) -> Result<Memo> {
        let url = format!("{}/memos/{}", self.base_url, memo_id);
        let mut payload = json!({});
        if let Some(t) = title {
            payload["title"] = json!(t);
        }
        if let Some(c) = content {
            payload["content"] = json!(c);
        }
        if let Some(col) = color {
            payload["color"] = json!(col);
        }
        if let Some(comp) = completed {
            payload["completed"] = json!(comp);
        }
        let resp = self
            .agent()
            .put(&url)
            .set("Authorization", &self.auth_header()?)
            .set("Content-Type", "application/json")
            .send_json(payload)?;
        let data: SingleMemoResponse = resp.into_json()?;
        Ok(data.memo)
    }

    pub fn delete_memo(&self, memo_id: i64) -> Result<()> {
        let url = format!("{}/memos/{}", self.base_url, memo_id);
        self.agent()
            .delete(&url)
            .set("Authorization", &self.auth_header()?)
            .call()?;
        Ok(())
    }

    pub fn carryover_to_next_day(&self, memo: &Memo) -> Result<Memo> {
        let next_date = next_day_str(&memo.date);
        let clean_title = memo
            .title
            .trim_start_matches("[结转]")
            .trim()
            .to_string();
        let new_title = format!("[结转] {}", clean_title);
        self.create_memo(
            Some(memo.owner_id),
            &next_date,
            &new_title,
            memo.body_text(),
            &memo.color,
            false,
        )
    }

    pub fn batch_complete(&self, memo_ids: &[i64]) -> Result<()> {
        if memo_ids.is_empty() {
            return Ok(());
        }
        let url = format!("{}/memos/batch-complete", self.base_url);
        self.agent()
            .post(&url)
            .set("Authorization", &self.auth_header()?)
            .set("Content-Type", "application/json")
            .send_json(json!({ "memoIds": memo_ids }))?;
        Ok(())
    }

    pub fn fetch_weekly_summaries(
        &self,
        start_week: &str,
        user_id: &str,
    ) -> Result<Vec<WeeklySummary>> {
        let mut url = format!(
            "{}/memos/weekly-summaries?startWeek={}&weeks=1",
            self.base_url, start_week
        );
        if !user_id.is_empty() && user_id != "all" {
            url.push_str(&format!("&userId={}", user_id));
        }
        let resp = self
            .agent()
            .get(&url)
            .set("Authorization", &self.auth_header()?)
            .call()?;
        let data: WeeklySummariesResponse = resp.into_json()?;
        Ok(data.summaries)
    }

    pub fn save_weekly_summary(
        &self,
        week_start: &str,
        owner_id: i64,
        goals: &str,
        deliverables: &str,
        actual: &str,
        risks: &str,
    ) -> Result<WeeklySummary> {
        let url = format!("{}/memos/weekly-summaries/{}", self.base_url, week_start);
        let resp = self
            .agent()
            .put(&url)
            .set("Authorization", &self.auth_header()?)
            .set("Content-Type", "application/json")
            .send_json(json!({
                "ownerId": owner_id,
                "goals": goals,
                "deliverables": deliverables,
                "actual": actual,
                "risks": risks,
            }))?;
        let data: SingleWeeklySummaryResponse = resp.into_json()?;
        Ok(data.summary)
    }
}
