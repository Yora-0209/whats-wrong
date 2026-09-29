# 窗边的一张纸：独立交互预览

阶段：已打通 **窗边首页 → 倾诉与主动续聊 → 自主结束 → 情绪日记**，并接入声音入口。未推送、未部署，没有替换原版。

原版备份标签：`backup/pre-paper-desk-20260929`。开发分支：`feature/paper-diary-preview`。

## 运行与检查

在仓库根目录：

```bash
npm run preview:diary
# 打开 http://localhost:5173/preview/
npm run test:diary
```

浏览器回归：

```bash
npm ci
npx playwright install chromium
npm run test:preview
```

已有 Chromium 可设置 `CHROMIUM_EXECUTABLE=/absolute/path/to/chromium`。本轮运行使用 Chromium 153；该二进制是环境测试依赖，不随产品提交。

## 已实现

- 首页：窗户、纸张、日记本、收音机独立图层，米白四周留白；日记本与收音机悬停/键盘聚焦时抬起、摇摆和显示标签。触屏单击进入；“减少动态效果”时关闭动画。
- 倾诉：原文与 AI 回应分开，用户主动继续，声音页面返回保留当前对话；失败重试不重复插入原文，取消等待后原文保留。无自动发送、自动追问或虚假成功回复。
- 结束：保存到日记/不保存结束/继续写。保存原文与完整对话，日记正文只显示用户文字；AI 回应放在“当时的对话”中。
- 日记：新建/编辑/删除/JSON 导出、回看日期、原版文字单向复制（不修改原库、不绕过访问锁）。使用独立 IndexedDB 数据库。
- 小画：可手写描述，或主动发送原文提取画面，修改后再发送给生图接口。生成/等待/取消/失败、配图随记录保存。没有用固定图冒充实时生成。
- 声音：复用原项目雨声/海潮音频，可播放/暂停/调音量，离开声音页或切换后台停止。
- 基础支持状态：明确危险用语触发固定支持文案，即使未配置模型也能显示；模型返回 crisis 时也切换。普通活动入口收起。此规则不是完整危机识别系统。

## 截图与测试

浏览器截图在 [qa](./qa/)：
- [桌面首页](./qa/desktop-home.png)
- [手机首页](./qa/mobile-home.png)
- [日记](./qa/desktop-journal.png)
- [对话交互](./qa/desktop-conversation.png)：其中成功 AI 回复是自动化测试数据，不代表已连接真实模型。

本轮验证：6 项 Node 测试通过；Chromium 桌面与 390px 手机流程通过。涵盖字体/图片加载、无横向溢出、失败重试、取消等待、上下文续聊、声音返回、保存刷新、导出删除、未配置生图的错误状态、明确危险用语支持状态、减少动态效果设置。没有调用付费模型进行真实联调。尚未验证 Safari、iOS/Android 真机。

## 接口配置

`POST /api/paper-chat` 使用原有 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`，限最近 12 条消息及总字数。超时或无配置明确返回失败，不回退到假回复。原 `api/chat.js` 保持不变。

配图接口默认关闭：
- `POST /api/art-brief`：主动发送日记原文给文字模型，返回 `title/scene/basis/abstract` 并验证 basis 为原文子串。语义仍需用户检查。
- `POST /api/diary-art`：只发送用户确认的 scene 与固定画风，不发送日记全文。要求提供方兼容 `/images/generations`、1024×1024、`b64_json` PNG/JPEG（按文件签名校验；不持久化会过期的远程 URL）。

启用配图需设置 `DIARY_ART_ENABLED=true`，以及 `IMAGE_BASE_URL / IMAGE_API_KEY / IMAGE_MODEL`。取消等待不能保证撤销提供方已开始的计费。图像服务最长等待 90 秒，部署函数时限需匹配。

公开启用前仍需配置部署端访问控制/持久化限流与用量预算，核实提供方的内容审核和数据留存策略，并验证图像风格稳定性。仅填写环境变量不等于完成上线准备。

## 视觉资产与字体

首页图层由内置 imagegen 生成，以已确认分镜为风格参考：粗蜡笔线、深绿/鼠尾草绿、砖红收音机、彩色小花园、米白留白。`notebook.png` 是固定日记示例插画。

字体以 [Xiaolai v3.126](https://github.com/lxgw/kose-font/releases/tag/v3.126) 为源，取 GB2312 与界面用字子集并转 WOFF2，衍生名 `PaperDesk Hand`，减少文件体积。未覆盖的生僻字使用系统字体回退。完整 OFL 在 assets/Xiaolai-OFL.txt。这是可读手写字体，不等同于插画里的蜡笔文字。

配图风格研究参考 [hand-drawn-styles](https://github.com/threerocks/hand-drawn-styles) 的蜡笔童涂；产品规则见 lib/diary-art.js。没有在运行时下载或执行 GitHub skill，也没有改写已安装的 clumsy-handwriting 母版。许可说明见 THIRD_PARTY_NOTICES.md。

## 数据说明与后续

对话只在当前页面内存中，用户主动保存才进入本地数据库。点击发送时，对话内容会经服务器传给模型；点击整理画面时发送原文；点击生图时发送描述。服务器代码不记录这些内容或上游错误详情，但托管/模型提供方的政策仍须核实。本地保存未加密，清除网站数据会丢失记录，请导出备份。

回看日期只是本地提示，不是加密封存或系统通知。编辑日记正文不会改写“当时的对话”存档。

后续：真实模型与生图联调、手机真机/其他浏览器验收、图片性能优化、呼吸/涂画活动、电影内容资源、正式发布前的访问保护。20 幕分镜尚未全部转成可运行功能。

## NewCoin / Seedream 预览配置

在 Vercel 项目 Settings → Environment Variables 中，仅选择 Preview：

| 变量 | 值 |
| --- | --- |
| IMAGE_BASE_URL | https://api.newcoin.top/v1 |
| IMAGE_MODEL | doubao-seedream-5-0-pro-260628 |
| IMAGE_API_KEY | 在 Vercel 中填写自己的密钥，不提交到 Git |
| DIARY_ART_ENABLED | true（预览访问控制就绪后启用） |

文字模型的 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL 也需在 Preview 环境可用。保存后重新部署功能分支。打开部署地址的 `/preview/`。

适配会将根主机地址补全 `/v1`，显式请求 `response_format: b64_json`，不自动重试付费生成。提供方尚未以真实密钥联调；若该模型只返回 URL 或使用聊天生图协议，需依据实际接口文档另行适配，不能视为已经接通。

本次适配复测：7 项 Node 测试通过（含主机路径、精确模型名、base64 请求及 PNG/JPEG 返回）。当前执行环境中 Chromium 启动发生 SIGSEGV，浏览器复测未完成；上轮截图与浏览器通过记录仅代表上轮状态。
