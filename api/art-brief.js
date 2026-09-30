import {
  BRIEF_PROMPT,
  validateBrief,
  parseBody,
  noStore,
} from "../lib/diary-art.js";
export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST")
    return res.status(405).json({ error: "仅支持 POST" });
  let body;
  try {
    body = parseBody(req);
  } catch {
    return res.status(400).json({ error: "请求格式不正确" });
  }
  if (
    typeof body.text !== "string" ||
    !body.text.trim() ||
    body.text.length > 2000
  )
    return res.status(400).json({ error: "请提供 1–2000 字的记录" });
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL)
    return res
      .status(503)
      .json({ error: "内容提取服务尚未配置，可以直接填写画面描述。" });
  try {
    const response = await fetch(
      `${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: AbortSignal.timeout(25000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: BRIEF_PROMPT },
            { role: "user", content: body.text },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error("upstream");
    const payload = await response.json();
    const brief = validateBrief(
      JSON.parse(payload.choices?.[0]?.message?.content),
      body.text,
    );
    return res.status(200).json(brief);
  } catch {
    return res
      .status(502)
      .json({ error: "暂时没能整理出画面。原文还在，也可以自己描述。" });
  }
}
