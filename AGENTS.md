# 赛果图编辑器开发说明

此仓库是编辑器的维护来源。只在这里开发编辑器，个人网站仓库保留入口和旧地址跳转。

- 界面、逻辑、样式和公开数据在 `src/`。`dist/` 是生成目录，不提交。
- 使用 Node.js 24，运行 `npm test`、`npm run build` 验证改动。
- 保持资源路径相对，确保 GitHub Pages 的 `/match-editor/` 子路径可用。
- 保留 `junkai-match-editor-v1` 存储键。队名、球员或赛事更名时考虑已有草稿的身份关联与历史号码。
- 原始 Word 报名表、手机号、备注不进入仓库。用 `scripts/prepare-match-rosters.py` 生成只含队名和姓名的公开数据。
- 功能变更需同时考虑预览和 SVG / PNG 导出。部署由 main 分支的工作流完成。
