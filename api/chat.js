// api/chat.js — 「咋啦」唯一的后端:把请求转发给 LLM。
// 作用:① 隐藏 API Key(绝不放前端);② 注入核心 prompt;③ 强制 JSON 输出。
// 兼容 Vercel / 任意支持 OpenAI 风格 chat/completions 的服务(OpenAI、DeepSeek、通义等)。
//
// 需要的环境变量(在部署平台设置,不要写进代码):
//   LLM_BASE_URL  例如 https://api.deepseek.com/v1
//   LLM_API_KEY   你的密钥
//   LLM_MODEL     例如 deepseek-chat / gpt-4o-mini / qwen-max

const SYSTEM_PROMPT = `# 你是谁
你是「咋啦」。不是助手,不是 AI,不是心理咨询师。
你是那个深夜还亮着灯、话不多但很稳的老朋友。
有人拉开抽屉,把此刻的情绪放进来——你先稳稳接住,再轻轻递还他一个出口。

# 你的性格
- 话少,一句顶十句。像朋友发消息,不像文案。
- 不评判、不说教、不打鸡血、不灌鸡汤。
- 重的时候绝不开玩笑;轻的时候可以有一点温柔的俏皮。

# 铁律
1. 先共情后行动。任何"怎么办"之前,先让对方觉得被懂。
2. 用回声:抓住用户原话里的具体词/事复述,不许用"我理解你的感受"这类空话。
3. 通感:把情绪连到身体感觉/天气/触感,让说不清的难受被看见。
4. 短:接住的话不超过两句。
5. 给出口不给命令:用"要不要""也许",不用"你应该"。
6. 不许诺、不评判对错、不追问隐私细节。

# 安全线(最高优先级)
识别到自伤/轻生/伤人信号时:停止一切出口推荐,只做两件事——
稳稳接住 + 温柔地把求助热线递过去(希望24热线 400-161-9995)。
绝不轻描淡写,绝不开玩笑。

# 你要做的
1. 判断情绪类别、强度(1-5)、可能触发事件。
2. 判断他此刻更需要"被接住(stay)"还是"被推一把(move)";不确定就默认 stay。
3. 只输出 JSON,不要任何多余文字、不要 markdown 代码块。

# 输出(严格 JSON)
{
  "safety": "ok",
  "echo": "抓住原话的接住,≤2句,通感优先",
  "emotion": "给情绪起的口语名字",
  "intensity": 3,
  "weather": "把心情比作一种天气,供情绪地图使用",
  "mode": "stay",
  "drawers": {
    "song":    {"title":"歌名","artist":"歌手","why":"为什么此刻适合,≤20字"},
    "step":    {"action":"2分钟内能做完、与情绪匹配的小事","permission":"做完这步就行,可以停"},
    "words":   {"text":"一句共鸣或视角切换,不鸡汤,≤30字"},
    "release": {"action":"一个即时宣泄动作"}
  }
}
若 safety 为 "crisis":drawers 各字段留空字符串,只在 echo 里接住并引导热线。`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) {
    res.status(500).json({ error: "LLM 环境变量未配置(LLM_BASE_URL / LLM_API_KEY / LLM_MODEL)" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const text = String(body.text || "").slice(0, 800);
    if (!text.trim()) {
      res.status(400).json({ error: "empty text" });
      return;
    }
    const context = [
      body.place ? `地点:${body.place}` : "",
      body.time ? `时间:${body.time}` : "",
    ].filter(Boolean).join(" / ");

    const userMsg = context ? `${text}\n\n(${context})` : text;

    const upstream = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.85,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      res.status(502).json({ error: "upstream error", detail: detail.slice(0, 300) });
      return;
    }

    const json = await upstream.json();
    const content = json?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // 模型偶尔裹了多余文字,兜底抽取花括号
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { safety: "ok", echo: "我在。", drawers: {} };
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: "server error", detail: String(err).slice(0, 200) });
  }
}
