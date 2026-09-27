# 智能网页工作日历备忘录-服务器版

这是从本机 HTML 日历迁移出来的服务器版 MVP。它不修改原来的 `智能网页工作日历备忘录-插件本机版.html`。

## 能力

- 登录后使用。
- 普通员工只能查看和编辑自己的记录。
- 管理员可以查看和管理全部记录、批量发布任务及管理人员。
- 支持多月日历、Markdown 编辑、研发大屏、团队榜、JSON 导入导出及管理员 Excel 导出。
- 当前权限角色为管理员（admin）和员工（staff），职务不作为授权依据。
- 记录保存在 PostgreSQL，不再保存在浏览器 IndexedDB。
- 使用 Docker Compose 一键部署。

## 默认账号

| 用户名 | 密码 | 角色 |
|---|---|---|
| admin | 0000 | 管理员 |

首次启动仅初始化 `admin`，普通员工通过注册创建。上线前必须修改默认密码、数据库密码和 `JWT_SECRET`。

## 启动

```bash
docker compose up -d --build
```

## 明暗主题

`frontend/theme.css` 使用随项目交付的 Radix Colors 色阶定义背景、文字、边框和状态色；`frontend/theme-init.js` 在页面显示前应用保存的浅色、深色或跟随系统设置。顶栏、工作台工具栏、月历卡片、常用弹窗和功能面板已接入 Tabler 组件与图标，资源及许可证见 `frontend/vendor/README.md`。修改主题时优先调整 `theme.css` 中的语义变量。

手机端点选日期后，月历下方会列出当天事项。提醒中心独立读取未完成事项，按逾期、三天内到期和普通待办分组；本次接口改动需使用全量部署。

从本机版重新生成 `frontend/index.html` 时，`scripts/build_frontend_from_local.py` 会补回主题脚本和样式表引用。

## 常用部署脚本

部署脚本已保留在：

```text
scripts/deploy.py
```

安装脚本依赖：

```bash
pip install -r scripts/requirements.txt
```

只部署前端，适合修改 `frontend/index.html`、`frontend/app.js`、`frontend/theme.css` 和本地视觉资源后使用：

```bat
cmd /c "set DEPLOY_HOST=服务器IP&& set DEPLOY_USER=root&& set DEPLOY_PASSWORD=你的密码&& python scripts\deploy.py --mode frontend --verify-public"
```

全量部署，适合后端、Docker 配置也改了以后使用：

```bat
cmd /c "set DEPLOY_HOST=服务器IP&& set DEPLOY_USER=root&& set DEPLOY_PASSWORD=你的密码&& python scripts\deploy.py --mode all --clean --verify-public"
```

说明：

- 默认公网端口是 `8090`，因为服务器已有服务占用 `8080`。
- 脚本不会保存服务器密码。
- `--clean` 只清理远程代码目录，不删除 Docker 数据库 volume。
- `--verify-public` 会先检查 `/api/health`，再用默认 `admin / 0000` 登录，确认部门为“研发部”，并请求当前月份日历数据。
- 如需指定验证月份或账号，可加 `--verify-month 2026-07 --verify-username admin --verify-password 0000 --verify-department 研发部`。
- 不要用 `docker compose down -v`，那会删除数据库数据。

访问：

```text
http://服务器IP:8090
```

## 停止

```bash
docker compose down
```

日常停止服务不要加 `-v`，该参数会删除数据库数据卷。

## 当前 MVP 非目标

- 暂不做附件上传。
- 暂不做复杂部门管理页面。
- 暂不接企业微信、钉钉等外部平台。
- 不会自动迁移本机版 IndexedDB 旧数据。管理员可导入兼容的 JSON 数组或含 `memos` 数组的对象；导入仅新增记录，不覆盖、不去重。
