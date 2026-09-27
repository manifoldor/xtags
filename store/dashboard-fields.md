# 开发者后台填报内容

**0.1.9 商城候选资料（2026-09-27）。** 填报前按 `GITHUB_PAGES.md` 核对公开政策已部署，并与当前运行包一致。

适用于 0.1.9 商城候选代码。以下为基于代码的数据分类建议，不替发布者勾选合规认证。

## 名称、描述、分类

- 名称：`Xtags`（以 manifest 为准，不添加“官方”“最佳”“免费无限”等词）。
- 版本：`0.1.9`；最低 Chrome 版本：`140`。
- 英文短描述已在 `_locales/en/messages.json`：`Label the intent behind posts on X with Jev, a model that returns probabilities rather than generated text.`
- 中文短描述已在 `_locales/zh_CN/messages.json`；详细文案见 listing 文件。
- 语言：English / 简体中文。
- 分类建议：选择后台中最接近阅读辅助/工具的分类；不要把未经验证的概率标签归为安全检测或内容真实性认证工具。
- Homepage / Support / Privacy URL：见 GITHUB_PAGES.md；发布后须匿名核对 0.1.9 的当前内容。

## Single purpose description（直接粘贴）

Xtags helps users interpret posts they browse on X by displaying AI-estimated intent labels and related signals, with probabilities, next to those posts. Its settings control only this labeling feature.

## storage justification（直接粘贴）

Stores the user's selected-service API key, preferences and versioned data-transfer consent locally, and caches classification results by post ID and a SHA-256 fingerprint of the classified text and author to avoid repeated requests. The cache does not persist raw post text. Persistent data is stored in chrome.storage.local, restricted to trusted extension contexts, not Chrome Sync. Content scripts receive only a sanitized in-memory settings snapshot with a key-present flag through chrome.storage.session. Per-page statistics are held in memory. The extension does not upload local settings to the developer.

## Host permission justification（直接粘贴）

https://api.typesafe.ai/* is required for the background service worker to send HTTPS classification requests to the default https://api.typesafe.ai/v1/systemone endpoint. The user supplies their own API key. The payload contains extracted post text, the author's handle, fixed classification questions and the selected model. The response is structured classification data, not executable code.

## X / Twitter content-script access（如后台单列该项，直接粘贴）

Content scripts run only on https://x.com/* and https://twitter.com/*. They locate text-post containers, extract post text, author handles and post IDs, and insert labels beside those posts. For collapsed long posts, a packaged script reads the full text already present in X's page data before the user expands the post. That full text is sent to the selected classifier after renewed consent. They do not request the browser's full history database or access unrelated sites. The classifier requires reading the post content to provide the visible labeling feature.

## Remote code

选择：**No, I am not using remote code.**

说明（如有输入框）：

All executable JavaScript is included in the extension package. The default TypeSafe endpoint or user-selected compatible service performs remote inference and returns JSON probabilities and classification fields. The extension validates and renders those data; it does not download, evaluate or execute scripts, WebAssembly or other executable logic from a remote server.

注意：远程 API ≠ 远程代码。测试工具中的 eval 仅存在于仓库 tests，打包脚本不会将其放入运行包。

## 数据类型：保守、如实申报

不要选择“不收集或处理任何用户数据”。Chrome 的披露范围包含本地处理和向第三方直接传输，即使开发者没有自己的服务器。

| 类别 | 建议 | 依据与边界 |
| --- | --- | --- |
| Website content | 是 | 提取帖子正文；折叠长推文也会读取页面数据中的全文，并发送第三方分类 |
| Personally identifiable information | 是 | 作者账号；正文可能含身份信息 |
| Authentication information | 是 | 用户提供的所选服务 API key，本地保存并作为认证头发送 |
| Web history | 建议是 | 已浏览页面中的帖子 ID 和判断持久缓存，可反映被处理帖子；不读取 Chrome history 数据库。不要把“无 history 权限”等同于不处理浏览相关数据 |
| Location | 按 IP 派生粗略位置如实披露，建议是 | TypeSafe（默认）或自定义服务会接收连接 IP；TypeSafe 的政策允许推断大致位置；不使用 GPS，不主动查询位置。最终按后台定义和实际服务商处理确认 |
| User activity | 不以独立行为追踪为目的收集 | 没有键盘、鼠标或点击行为日志，没有分析 SDK；DOM 观察用于找到帖子，不应描述为完全不观察页面 |
| Personal communications | 不主动读取私信/邮件；需核对保护帖子范围 | 当前未过滤非公开帖子。若实际处理的数据符合后台此类别定义，应勾选并更新一致披露；不能保证仅公开信息 |
| Health / Financial and payment information | 非专项采集 | 不读取医疗或支付账户。正文可能包含这些信息，不能对任意正文承诺无敏感信息；按后台具体定义与最终处理范围确认 |

关于数据使用的认证项，仅在发布者确认实际运营遵守限制后勾选：不出售、不用于无关用途、不用于信用/借贷决策。隐私政策包含 Limited Use 声明；不要将生成文案视作已替你完成认证。

## 收费与内容分级

扩展可免费提供，但需要用户自备所选服务的访问权（默认 TypeSafe），API 使用可能收费。详细说明开头已披露。后台若有额外购买/订阅相关问题，按实际服务商要求回答。

扩展不自行提供成人内容；任意 X 内容是否影响当前商城的内容分级需按表单指引判断，不因使用 X 就自动勾选或自动排除 Mature。

依据：[Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)、[TypeSafe privacy](https://typesafe.ai/legal/privacy-policy)。


## optional_host_permissions justification（新增，直接粘贴）

The optional https://*/* declaration allows users to choose a TypeSafe-compatible API host that is not known at install time. The extension requests access only to the specific host entered by the user, from a Settings button click. It does not request all HTTPS hosts at runtime. Custom requests use the exact saved endpoint, omit cookies and reject redirects. Changing the endpoint pauses processing, clears the API key and cache, and requires consent bound to that destination. Content scripts still run only on X / Twitter.

自定义服务与官方服务处理相同数据类型。隐私申报中的接收方应描述为 TypeSafe（默认）或用户配置的 API 服务商；不能把 TypeSafe 的不训练或保留政策套用到自定义服务。
