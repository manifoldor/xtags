# GitHub Pages 发布隐私政策

**0.1.9（2026-09-27）：已发布并验证。** 提交 `0180e81` 已推送到 `main`。匿名读取英文政策、中文政策和支持页均返回 HTTP 200，内容与本地 `docs/` 逐字节一致；随包的 `extension/privacy/` 页面也与 `docs/` 一致。

发布状态（2026-09-23）：**0.1.8 已上线并匿名验证。** 源码和资料提交 `b914422` 已推送至 `main`。GitHub Pages 发布来源为 **Deploy from a branch → main → /docs**，强制 HTTPS。公开中英文政策、主页、支持页和样式文件均返回 200，与本地 `docs/` 逐字节一致；随包 `extension/privacy/` 页面也与 `docs/` 一致。

[0.1.5 首次部署](https://github.com/manifoldor/xtags/actions/runs/35491604540)已成功。下列 0.1.9 地址已于 2026-09-27 再次匿名验证。

## 已发布地址

| 用途 | URL |
| --- | --- |
| 主页 | https://manifoldor.github.io/xtags/ |
| 商城 Privacy policy | https://manifoldor.github.io/xtags/privacy.html |
| 中文政策 | https://manifoldor.github.io/xtags/privacy.zh-CN.html |
| Support URL | https://manifoldor.github.io/xtags/support.html |

商城 Privacy policy 字段填写上方英文政策地址。0.1.9 页面还说明有限失败恢复、响应字段净化和“暂停并清空缓存”的行为。

## 后续更新

1. 修改 `docs/` 中的主页、支持页和中英文隐私政策；对应页面同步到 `extension/privacy/`。
2. 运行 `npm test`，检查随包政策与网站内容一致；改动随包文件后执行 `python3 scripts/package-store.py` 重建运行包。
3. 提交并推送至 `main`，GitHub Pages 会自动部署 `/docs`。
4. 在仓库 Actions 中确认部署成功，再验证公开页面与最新内容一致。

发布目录只有 `docs/`，包含 `.nojekyll`，不需要自定义构建步骤。网站没有第三方字体、分析脚本；`store/` 不在 Pages 发布根目录中。不要将审核 API key、X 登录密码或其他秘密提交至公开仓库。

先前 CLI 令牌创建 Pages 时返回 403；本次通过已登录的 GitHub 网页完成配置，无需更改令牌权限。

官方说明：[配置 Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。
