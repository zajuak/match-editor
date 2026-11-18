# 校内独立副本

编辑器：http://10.129.83.25:8083/ ；管理后台：http://10.129.83.25:8083/admin.html 。需要可访问该校内服务器的网络。

服务为 `match-editor`，使用 Node.js 24 内置 SQLite。复用现有 Worker 的登录、名单管理、Word 导入、版本冲突和事务逻辑；服务器使用独立数据库、会话和密码配置，不连接 Cloudflare。初始名单复制云端当前公开数据，并保留赛事、球队和球员 UUID、legacy_key 及 revision。此后两边分别维护，服务器默认名单读取本地数据库最新版本。

## 文件位置

- `/opt/match-editor/releases/<版本>/`：代码及 `campus-dist/` 前端。
- `/opt/match-editor/current`：当前发布软链接。
- `/opt/match-editor/runtime/bin/node`：独立 Node 24 运行程序。
- `/var/lib/match-editor/rosters.sqlite`：独立数据库，WAL 模式。
- `/var/lib/match-editor/initial-copy.json`：首次复制的公开名单，仅用于空库初始化。已有数据库启动时不会重新导入。
- `/etc/match-editor.env`：仅管理员可读的 `ADMIN_PASSWORD_HASH`，不放进发布包或 Git。

比赛草稿和历史号码仍保存在各浏览器 localStorage。服务器端口与 GitHub Pages 是不同来源，浏览器草稿不会随服务器名单复制而自动迁移。

## 构建与发布

使用 Node 24，运行 `npm test`、`npm run build:campus`。校内构建生成 `campus-dist/`，公开 API 配置为 `globalThis.location.origin`，不会使用本机环境里可能存在的 Cloudflare URL。GitHub Pages 的 `npm run build` 流程保持使用原 API。

发布包包含 `campus-dist/`、`server/`、`cloudflare/worker.mjs`、`cloudflare/auth.mjs`、`cloudflare/migrations/`、`src/core.mjs`、`src/rosters.mjs`、`src/registration-plan.mjs` 和 `deploy/`。不需要 `node_modules`，不携带密码或原始报名表。

首次部署需准备独立 Node 24、初始名单和 `/etc/match-editor.env`。将发布包解压到一个新的 release 目录后运行：

```sh
sudo bash /opt/match-editor/releases/<版本>/deploy/install-release.sh /opt/match-editor/releases/<版本>
```

安装脚本在升级前通过 SQLite 在线备份 API 保存现有数据库，随后切换代码软链接、重启并检查 `/health`。失败时恢复之前的代码目录。升级不重新复制云端名单或覆盖数据库。

## 验证

`tests/campus-server.test.mjs` 使用临时 SQLite，通过真实 HTTP 检查静态资源、独立名单、登录和匿名拒绝、报名表替换、版本检查、默认名单更新、退出、重启持久性及拒绝重新导入；已有 API 测试也使用生产 SQLite 适配器。HTTP 页面通过 `getRandomValues` 生成 UUID，兼容缺少 `crypto.randomUUID` 的环境。

生产检查读取 `/health`、`/api/rosters` 和前端资源；登录测试结束后退出，不保存测试球员或比赛。
