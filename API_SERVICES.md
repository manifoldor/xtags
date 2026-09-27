# API 服务配置

默认地址为 `https://api.typesafe.ai/v1/systemone`，无需修改。自定义服务必须兼容 **TypeSafe System One**，不是仅凭 URL 就能调用任意大模型接口；当前不适配 OpenAI `/v1/chat/completions` 或 `/v1/responses`。

## 使用步骤

1. 在 popup 点击“设置”，服务提供方选择“自定义服务”。
2. 输入完整 HTTPS 接口 URL（包括路径），点击“保存服务地址”，允许 Chrome 访问所选域名。
3. 阅读页面中明确显示的接收地址和数据说明，再勾选并同意。
4. 填入该服务签发的 API key。配置保存在本地，重开页面后仍有效。

不自动追加路径。URL 不允许包含用户名、密码、查询参数或片段；认证统一使用 Bearer header。更换地址会暂停分类、清空旧 key 和缓存、撤销原同意，切回官方也需要重新配置 key。未保存的 URL 不改变当前服务，且会暂时禁止填写 key 或授予同意，避免把凭证配置到错误接收方。

## 兼容接口约定

- 方法：`POST`，`Content-Type: application/json`，`Authorization: Bearer <该服务的 key>`。
- 请求字段：`state.post.text`、`state.post.author`（handle 或 null）、`questions`、`model`。默认 `model` 是 `jev-latest`；四组 `questions` 的实际定义见 `extension/background.js`。
- `questions` 定义 intent（choice）及 rage_bait、synthetic、undisclosed_ad（noul）判断。服务需要返回对应的数值概率，而非聊天文本。
- 成功响应示例（仅示意格式，不代表真实分类）：

```json
{
  "answers": {
    "intent": {
      "choice": "inform",
      "confidence": 0.9,
      "probabilities": {"inform": 0.9, "persuade": 0.02, "provoke": 0.02, "sell": 0.02, "entertain": 0.02, "other": 0.02}
    },
    "rage_bait": {"noul": 0.1},
    "synthetic": {"noul": 0.2},
    "undisclosed_ad": {"noul": 0.1}
  },
  "usage": {"input_tokens": 100}
}
```

成功响应上限为 64 KiB（按实际读取的字节数限制；声明超限时直接拒绝），不得依靠额外大型调试字段传输数据。概率必须是 0–1 的有限数字，intent.choice 为示例中的六种之一。客户端只保留六类已知概率、choice/confidence 和三个 noul 数值，忽略其他字段；旧缓存迁移时同样净化。`usage.input_tokens` 可省略。错误使用适当的非 2xx 状态；429/5xx 和网络故障会有限重试。HTTP 错误正文不读取、不转发到页面或本地诊断；只提供受控错误码和 HTTP 状态。响应过大或格式不正确不自动重试。后台一轮最多 3 次；页面对暂时性失败最多再恢复两轮，共最多 9 次，用户可在 popup 手动重试失败项。HTTP 重定向不会被跟随，请直接填写最终接口地址。

## 数据与权限

正文、作者账号、固定问题、模型参数和认证 key 发往用户保存并同意的服务。请求不携带 Cookie，不执行接口返回的代码。自定义服务的数据保留、转发及收费规则由其运营方决定，不能沿用 TypeSafe 的承诺。

Manifest 声明 `https://*/*` 为可选域名权限，以容纳安装时未知的服务地址；运行时只申请所填域名。Chrome 的域名权限涵盖该主机路径和端口，但实际请求仍严格绑定保存的完整 URL。内容脚本仍只运行在 X / Twitter。撤销域名权限会取消在途请求并阻止继续发送；重新保存服务地址可重新申请权限。

自定义服务只显示 token 数，不套用 TypeSafe 的费用估算。
