# 足球赛果图编辑器

独立开发的静态网页，支持共享赛事与报名名单、管理员维护、比赛事件、本场号码及历史号码、首发与守门员、实时赛果图预览，以及 PNG / SVG 导出。前端部署在 GitHub Pages，Supabase 提供共享名单、邮箱登录和数据库行级权限。

- 在线使用：https://zajuak.github.io/match-editor/
- GitHub 仓库：https://github.com/zajuak/match-editor
- 个人网站旧链接：https://zajuak.github.io/tools/match-editor/（跳转到独立版本）

## 本地开发

使用 Node.js 24。安装依赖后，按 `.env.example` 准备本地 `.env`，再加载公开 Supabase 配置并启动：

```sh
npm ci
set -a
source .env
set +a
npm run dev
```

打开 http://127.0.0.1:4323/ ，管理页面为 http://127.0.0.1:4323/admin.html 。未配置 Supabase 时只能使用不依赖官方名单的功能。

```sh
npm test
npm run build
npm run preview
```

`npm run build` 同样要求已加载两项公开环境变量。构建产物为 `dist/`；预览默认使用 4323 端口。指定其他端口：`npm run dev -- --port 4324`。

本地权限集成测试需要 Docker。先运行 `npx supabase start`，再根据 `npx supabase status` 设置 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`，最后运行 `npm run test:rls`。该脚本只创建并清理带随机后缀的本地测试数据。

## 目录

- `src/index.html`、`src/editor.mjs`：编辑界面、本地草稿和下载。
- `src/admin.html`、`src/admin.mjs`、`src/admin-api.mjs`：管理员登录和名单维护。
- `src/core.mjs`：球员身份、草稿迁移、号码、计分和 SVG 渲染。
- `src/rosters.mjs`、`src/supabase-client.mjs`：共享名单读取和 Supabase 客户端。
- `src/importers.mjs`：静态种子名单与 Word 报名表解析。
- `src/data/`：仅用于初始导入和完整性测试的精简名单。
- `supabase/migrations/`：表结构、管理员权限和种子事务。
- `src/SMC_files/`、`src/vendor/`：图标、fflate、Supabase 浏览器包及许可证。
- `scripts/`：开发服务器、静态构建、报名表转换和种子导入。
- `tests/`：编辑器、云端映射、草稿迁移和构建检查。

## 当前功能

1. 页面自动加载 Supabase 中的最新共享名单。初始数据为 `2026年新生杯男子足球赛` 18 支球队、491 名球员，`2026-27北大杯女子足球赛` 8 支球队、135 名球员。女足赛事不录入或展示首发阵容，也无需指定首发守门员；从报名名单选择事件球员，在“本场号码”可选填号码并沿用历史号码，导出不要求事件球员号码。选择赛事后，主客队列表仅显示该赛事球队。
2. 在“首发与本场号码”填写号码、勾选首发，双方各从本队首发中选择一名守门员。赛果图中双方守门员各排在本队首发第一位，姓名显示为“姓名(GK)”，其余球员保留勾选顺序。守门员号码可留空，无号码时号码位置显示 GK；守门员参与事件时同样无需号码。其他首发球员仍需号码，有号码的守门员仍受同队号码唯一性检查。球员旁显示上一次号码，可点击“沿用”。新比赛需重新指定守门员，本场号码为空，本场修改不会覆盖上次参考。
3. “自定义比赛”支持填写双方队名及首发，每行使用“号码 姓名”或纯姓名。输入球员成为首发。添加事件时可手动填写姓名或选择已有球员，支持未列入首发的替补；新增事件球员不会自动加入首发，非首发球员的号码可留空；重新应用会清空当前事件。未应用的修改会阻止添加事件和导出，避免导出旧内容。共享名单加载失败时不会使用旧静态名单，自定义比赛仍可保存和导出。
4. 乌龙球只填写时间和得分球队，批量格式为 `时间,球队`，图中在得分方一侧显示“OG”；红牌、黄牌、两黄转红的球员选项首位提供“领队”，自定义比赛及批量录入也支持“领队”，不占用球员名单或号码；其他事件直接选择球员；换人可成对添加，批量输入支持姓名或本场号码，自定义比赛还支持新球员姓名及“号码 姓名”。赛果图中所有事件只显示球员姓名，不显示号码；首发阵容仍显示号码。同一时间的事件可拖动或用 ↑ ↓ 调序。改号码后事件与首发仍关联同一球员。
5. 比分根据事件计算；乌龙球选择得分球队，无需指定球员，给所选球队加分。时间 `点` 表示点球大战，比分单列。
6. 导出 PNG（通常为 1600px 宽）或自包含 SVG，图标题居中显示。导出前必须为双方各指定一名首发守门员，并补齐显示在首发阵容中的非门将号码；仅参与事件的球员无需填写号码。自定义比赛先应用首发，再选择守门员。取消守门员的首发资格或清空首发，会同步清除对应守门员选择。特别长的图片会降低 PNG 倍率，可优先使用 SVG。

7. “名单管理”使用 Supabase 邮箱密码登录。匿名访客和普通登录用户只能读取名单；数据库 `admin_users` 白名单中的管理员可以维护赛事、球队和球员、调整顺序及是否启用首发。排序由数据库单个事务完成，失败会整体回滚。权限由 RLS 在数据库端执行，不能通过修改前端绕过。

比赛草稿与历史号码保存在当前浏览器 localStorage，不上传服务器，没有跨设备同步。赛事、球队或球员改名后通过稳定 UUID 保留有效关联；已经删除的记录会清理。静态 JSON 不会在云端失败时作为旧名单回退。

## 维护报名名单

日常修改直接在 `admin.html` 完成，不再修改 JSON 或重新导入。新增、改名、删除和排序会写入 Supabase；编辑器重新加载后读取最新数据。

`src/data/` 只用于首次建库和完整性测试。原始 Word 报名表可能含手机号、球员身份和备注，必须留在仓库外，仓库只保留球队和球员姓名。需要重新生成种子基准时运行：

```sh
python3 scripts/prepare-match-rosters.py ../赛果图编辑器/data/manifest.json src/data
npm test
```

首次导入前必须先应用 migration，并仅在目标名单表为空时运行：

```sh
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key
node scripts/import-rosters.mjs
unset SUPABASE_SERVICE_ROLE_KEY
```

脚本核对 2 个赛事、26 支球队、626 名球员，使用单个事务且拒绝覆盖非空名单。service role 仅在本机进程环境中使用，不要写入 `.env.example`、前端配置、Actions 或日志。日常后台维护后不要再运行种子导入。

## 部署

首次上线按顺序操作：

1. 在 Supabase 按文件顺序执行 `supabase/migrations/` 下的迁移，关闭公开邮箱注册。
2. 在 Supabase Auth 创建管理员，把其用户 UUID 插入 `admin_users`（`role` 为 `admin`）。白名单只能由可信的数据库管理员修改。
3. 按上一节执行一次种子导入并核对数量。
4. 在 GitHub 仓库 Variables 设置 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY`，然后发布前端。

向 `main` 推送后，GitHub Actions 自动执行测试、构建并发布到 GitHub Pages。Pull request 只检查，不部署；工作流不会自动修改生产数据库。两项公开配置会进入静态产物，service role 不应出现在任何前端或 Actions 配置中。

构建为脚本和样式生成内容版本号；修改前端代码后，浏览器会请求新资源。页面与数据使用相对路径，可以部署在 `/match-editor/` 或其他目录下。

个人网站仅保留入口和旧地址跳转。后续编辑器功能开发、名单更新、测试与发布均在本仓库完成，不再维护网站中的代码副本。

## 数据与来源

草稿使用原有 localStorage 键 `junkai-match-editor-v1`。旧页面与新页面同属 `https://zajuak.github.io`，旧浏览器草稿与历史号码可以继续读取。本地开发使用不同域名或端口时，存储独立。

本项目从个人网站仓库的编辑器代码提取，来源提交为 `38cc06d4e55bb7a9f54549620840fefb65bb3634`。此前修改历史保留在 https://github.com/zajuak/zajuak.github.io 。

fflate 和 Supabase JS 的许可证分别见 `src/vendor/FFLATE-LICENSE.txt`、`src/vendor/SUPABASE-LICENSE.txt`。赛果事件图标沿用原编辑器的本地素材。
