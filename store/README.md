# Xtags Chrome Web Store 提交资料

0.1.9 候选资料更新于 2026-09-27。修复内容见 [更新说明](RELEASE_NOTES_0.1.9.md)。上传扩展时只选择本地生成的 `store/xtags-0.1.9-chrome-web-store.zip`：ZIP 根目录直接包含 `manifest.json`。不要上传仓库目录、截图或整套资料备份。

## 文件用途

| 文件 | 用途 |
| --- | --- |
| `xtags-0.1.9-chrome-web-store.zip` | Chrome Web Store 扩展运行包，只含白名单内的运行文件 |
| `package-report.json` | 包哈希、文件清单及一致性检查 |
| `listing.en.txt` / `listing.zh-CN.txt` | 英文、简体中文详细说明 |
| `dashboard-fields.md` | 单一用途、权限理由、远程代码与数据类型申报建议 |
| `reviewer-instructions.en.txt` | 审核步骤模板；专用 key 和必要访问方式只填商城私有字段 |
| `disclosure-copy.md` | 设置页实际披露内容和同意流程 |
| `PRE_SUBMISSION.md` | 送审前检查及未完成的真实环境验证 |
| `GITHUB_PAGES.md` | 公开隐私政策 URL 和发布核对方法 |
| `assets/` / `ASSETS.md` | 128 图标、440×280 小宣传图、可选大图、实际标签及界面截图与来源说明 |
| `../docs/` | 从 GitHub Pages 发布的主页、支持页和中英文隐私政策 |
| `../extension/privacy/` | 随扩展提供、无需联网也可阅读的同版政策和支持页 |

建议将用户提供并授权公开使用的真实标签图 `assets/screenshot-labels-zh-CN.png` 放在中文商城截图首位，英文版可用 `assets/screenshot-labels-en.png`。其标签概率来自早期一次实际判断，不能用于断言新版对同帖仍给出同一数值。弹窗和设置页截图取自本地界面渲染；图片不代表完成真实服务商联调。图片尺寸和来源见 [ASSETS.md](ASSETS.md)。

## 接收方与披露

默认服务为 TypeSafe，也允许用户选择兼容的第三方 HTTPS 服务。首次上传前，设置页会明确说明正文、作者账号、接收地址、折叠长文在展开前发送全文、受保护帖子和可能收费；用户必须主动勾选同意。更换服务地址会清除旧 key 与同意。隐私政策同时放在运行包里，公开地址如下：

- 主页：<https://manifoldor.github.io/xtags/>
- 商城 Privacy policy URL：<https://manifoldor.github.io/xtags/privacy.html>
- 中文政策：<https://manifoldor.github.io/xtags/privacy.zh-CN.html>
- Support URL：<https://manifoldor.github.io/xtags/support.html>

GitHub Pages 使用 `main` 分支的 `/docs`。0.1.9 的公开政策与支持页已匿名核对，内容与包内 `extension/privacy/` 一致；验证记录及后续发布步骤见 [GITHUB_PAGES.md](GITHUB_PAGES.md)。

## 重建与验收

在仓库根目录执行 `npm test`、`npm run test:browser`、`python3 scripts/store-artwork.py`、`python3 scripts/package-store.py`。打包脚本采用固定清单，不会把文档、截图、测试夹具或完整资料备份塞进商店 ZIP。用户提供的实际标签原图由单独的截图脚本维护，不由界面图片脚本覆盖。

本地 48 项单元测试、52 项 Chrome DOM 回归使用模拟服务；正式送审前仍需完成真实 X 页面、真实服务商 key、不同语言与主题，以及 Chrome 中 key 访问边界的检查。发布者需在商城 Test instructions 的**私有字段**提供有效审核 key、额度和可访问的测试帖子，切勿把凭证写入本仓库、图片或公开文案。

项目署名 yishan，联系邮箱 `linyishan@gmail.com`。发布者须核对这些信息及隐私申报，且只对实际运营中遵守的数据使用限制作出认证。

官方依据：[图片规范](https://developer.chrome.com/docs/webstore/images)、[披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)、[隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[审核说明](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)。
