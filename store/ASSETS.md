# 图片清单与来源

**0.1.9（2026-09-27）：** 弹窗、设置页和宣传图已用当前本地界面重新生成。用户提供的原始实际标签图及其 1280 × 800 商城画布保持原貌；图中概率是当时实际判断结果。

| 文件 | 尺寸 | 使用位置 | 来源 |
| --- | --- | --- | --- |
| assets/screenshot-labels-zh-CN.png / screenshot-labels-en.png | 1280 × 800 | 建议作为商城第一张截图 | 用户提供的实际标签截图，等比嵌入中英文说明画布，保留原有标签、概率和箭头 |
| assets/screenshot-labels-original.png | 2512 × 1404 | README 原图；不直接上传商城 | 用户于 2026-09-20 提供并授权公开使用的本人截图 |
| assets/icon-128.png | 128 × 128 | 扩展图标 | 复用 extension/icons/on/icon128.png |
| assets/promo-small.png | 440 × 280 | 必需的小宣传图 | 本项目图标、品牌名与 CSS 图形 |
| assets/promo-marquee.png | 1400 × 560 | 可选的大宣传图 | 同一品牌构图 |
| assets/screenshot-settings-en.png | 1280 × 800 | 英文设置截图 | 实际设置页 HTML、JS、翻译代码在本地 Chrome 中渲染 |
| assets/screenshot-settings-zh-CN.png | 1280 × 800 | 简体中文设置截图 | 同上，中文界面 |
| assets/screenshot-popup-en.png / screenshot-popup-zh-CN.png | 1280 × 800 | 中英文快捷操作截图 | 当前 popup 代码的本地渲染 |

设置截图使用空 API key、默认设置和本地模拟的 Chrome storage/runtime 接口，设置页展示默认未同意状态和真实披露区域，popup 展示设置入口；没有改写产品控件或伪造分类结果。popup 图外侧说明文字是宣传排版；设置页图直接展示页面。图片不代表完成了真实 X / TypeSafe 联调。当前设置和 popup 图片按 0.1.9 界面代码重新生成；以后修改披露界面也应重生成截图。

**实际标签截图已补充。** 使用 `screenshot-labels-zh-CN.png` 作为中文商城第一张截图，英文商城可使用 `screenshot-labels-en.png`（图内明确说明界面为简体中文）。原截图中的“挑拨 0.68”和红色箭头均由用户提供，没有重新生成或修改帖子、标签、概率；它记录的是提示词调整前的一次真实输出，新版对同一帖子的分数可能不同。原图用于中英文 README，商城图片仅将原图等比嵌入 1280 × 800 的 HTML 画布。此截图展示实际效果，不代表已完成全部端到端回归。每种语言最多上传五张截图；后续依次使用快捷操作、设置页及可选自定义服务示例。

宣传图不按 locale 单独提供，因此仅使用品牌名。没有使用 X / Chrome 商标来暗示官方关联，也没有使用外部图库。

## 重新生成

在项目根目录运行：

```sh
python3 scripts/store-artwork.py
```

需要本机 Chrome；其他系统可通过 `CHROME_BIN` 指定 Chromium 可执行文件。脚本使用临时独立浏览器配置，不读取用户浏览器账户或扩展数据。HTML 源文件写入 `store/artwork/`，PNG 写入 `store/assets/`。图片生成后仍应目视检查，尤其在不同系统字体下。

依据：[Chrome Web Store 图片规范](https://developer.chrome.com/docs/webstore/images)。

`assets/screenshot-service-custom-zh-CN.png` 是自定义服务输入示例，URL 为保留示例域名 api.example.com 的未保存草稿；用于展示操作入口，不是可用服务推荐或真实联调结果。

实际标签截图的画布文件为 `store/artwork/screenshot-labels-zh-CN.html` 和 `screenshot-labels-en.html`，通过 `python3 scripts/store-label-screenshots.py` 重新渲染。原图不由设置页图片生成脚本覆盖。
