# 设置页数据上传披露与同意

**0.1.9（2026-09-27）：** “暂停并清空缓存”、有限失败恢复和最小化诊断已反映到中英文政策；公开页面发布后按 `GITHUB_PAGES.md` 核对。

状态：**已接入 0.1.9 候选版。** 设置页使用随扩展打包的中英文隐私政策，离线可读；商城 [Privacy policy URL](https://manifoldor.github.io/xtags/privacy.html) 使用 GitHub Pages 公开页面。2026-09-23 的访问记录对应旧版内容，本版须重新核对。

当前本地待发布版本的同意版本为 2；后台在排队、实际请求/重试以及接收结果后验证当前配置。折叠长推文现在会在展开前上传 X 页面数据中的全文，因此原版本同意不会自动沿用，用户需要重新阅读披露并同意。同意还绑定完整 API URL；已有官方同意只对官方地址有效，自定义服务须重新同意。撤回会把同意版本清零并暂停；key 和缓存保留，可另行清空。

## 中文（默认官方服务）

### 启用前请了解

Xtags 会将你浏览页面中提取的帖子正文和作者账号发送给 TypeSafe AI，以生成意图和信号标签。已渲染的帖子可能不在当前视口内，也可能不是公开帖子。需要你的 TypeSafe API key，使用可能产生费用。AI 判断可能有误。

折叠的长推文会在点击展开前，读取 X 页面数据中已有的全文并发送分类。

链接：隐私政策 · TypeSafe 隐私政策 · 获取 API key

未预选同意项：我已了解上述数据传输，并同意使用上方地址的服务进行分类。

按钮：同意并启用

## English (default official service)

### Before you enable Xtags

Xtags sends post text and author handles extracted from pages you browse to TypeSafe AI to generate intent and signal labels. Rendered posts may be outside the current viewport or may not be public. Your TypeSafe API key is required, and API usage may incur charges. AI estimates can be wrong.

For collapsed long posts, Xtags reads the full text already present in X's page data and sends it for classification before you expand the post.

Links: Privacy policy · TypeSafe privacy policy · Get an API key

Unchecked consent: I understand this data transfer and agree to use the service at the address shown above for classification.

Button: Agree and enable

## 实现验收

- 披露应在首次请求之前可见，不藏在默认折叠的“关于”中。
- 没有明确同意时不发送正文，后台也要检查同意状态，不能仅靠前端禁用按钮。
- 同意状态带政策版本；升级需补充同意时不自动视为已同意。
- 提供暂停/撤回路径；撤回停止出队、尝试取消在途请求、丢弃旧结果。
- 语言切换不会重置同意，不会额外请求。
- 持久化失败时保持未启用并显示错误；不先发送再保存同意。
- 对已安装用户迁移行为进行测试，避免沿用 enabled=true 静默上传。

这是实现显著披露与同意的一种建议方案。官方要求的是有效披露与知情同意，不限定必须使用上述勾选框样式。

## 自定义服务披露

设置页会显示完整的当前接收地址。选择自定义服务后，说明改为“正文、作者账号与 API 凭证发送给该运营方”，不再展示 TypeSafe 的隐私链接或申请 key 链接。提醒用户查阅该服务商的数据保留与处理规则。更换 URL 后清空 key 和同意；未保存 URL 时禁用 key 配置与新的同意操作。
