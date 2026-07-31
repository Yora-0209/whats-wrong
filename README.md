# 咋啦

> 一个接住情绪、再轻轻递给你一个出口的地方。

面向独居 / 异乡打拼的年轻人：当负面或说不清的情绪没有出口、身边又找不到人时，
拉开「咋啦」的抽屉，把此刻放进来。它先**稳稳接住**（命名 + 共鸣），
再递给你一个**转化的出口**：一首歌、一件小到不能拒绝的小事、一句共鸣的话、一个宣泄动作。
愿意的话，把这一刻收进**情绪地图**；不愿意，让它当场消失。

## 产品三层

- **即时层**：接住 → 转化（打开即用）
- **记忆层**：情绪地图（时间 / 地点，需你亲手收纳）
- **预见层**：基于规律的预防性出口（v2）

## 目录

```
咋啦/
├── index.html      开屏抽屉 + 全部页面结构
├── styles.css      视觉基调（深夜房间 · 一盏暖灯）
├── app.js          交互逻辑（接住转化 / 情绪地图 / 降级 mock）
├── api/chat.js     唯一后端：转发 LLM，隐藏密钥，强制 JSON
├── prompt.md       核心 Prompt（唯一事实来源）
├── package.json
└── README.md
```

## 本地预览

不带 AI（看界面 + 交互，用内置 mock 回复）：

```bash
cd 咋啦
python3 -m http.server 5173
# 打开 http://localhost:5173
```

带 AI（本地跑含 /api 的完整版）：

```bash
npm i -g vercel
vercel dev        # 首次会让你登录并链接项目
```

## 部署（Vercel，零构建）

1. 把本目录推到 Git 仓库，在 [vercel.com](https://vercel.com) 导入。
2. Framework Preset 选 **Other**（纯静态 + Serverless Functions，无需构建命令）。
3. 在 **Settings → Environment Variables** 配置以下三项，然后重新部署：

- `LLM_BASE_URL` — 例如 `https://api.deepseek.com/v1`
- `LLM_API_KEY` — 你的密钥
- `LLM_MODEL` — 例如 `deepseek-chat` / `gpt-4o-mini` / `qwen-max`

> 兼容任何 OpenAI 风格 `chat/completions` 接口。

## 安全与隐私（设计约束，别破坏）

- **API Key 只放环境变量**，永远不进前端、不进仓库（`.env*` 已在 `.gitignore`）。
- **情绪数据只存用户本地**（`localStorage`），不上传服务器；地图内容需用户**主动收纳**，否则「让它消失」即焚。
- **危机干预**：`api/chat.js` 与 prompt 内置安全线，识别到自伤/轻生信号时只接住 + 递出求助热线，收起所有「出口」。
  上线前请**核实当前有效的危机干预热线号码**（当前占位：希望24热线 400-161-9995）。

## 待办（v2）

- 情绪热力图叠加**空间维度**（地点标签的分布与关联）
- 规律洞察与预防性出口（预见层）
- 正面情绪的「放大与留存」
