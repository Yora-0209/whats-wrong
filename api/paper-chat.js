import {
  PAPER_PROMPT,
  SAFETY_REPLY,
  explicitDanger,
  parseProviderReply,
  providerMessages,
  validateMessages,
} from "../lib/paper-chat.js";
import { parseBody, noStore } from "../lib/diary-art.js";
export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST")
    return res.status(405).json({ error: "仅支持 POST" });
  let messages;
  try {
    messages = validateMessages(parseBody(req).messages);
  } catch {
    return res
      .status(400)
      .json({ error: "这段话的格式不完整，请保留文字后重新试试。" });
  }
  if (explicitDanger(messages.at(-1).content))
    return res.status(200).json({ safety: "crisis", echo: SAFETY_REPLY });
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL)
    return res
      .status(503)
      .json({ error: "回应服务尚未连接。你可以继续写，或只保存文字。" });
  let stage = "request";
  try {
    stage = "upstream";
    const upstream = await fetch(
      `${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: PAPER_PROMPT },
            ...providerMessages(messages),
          ],
        }),
      },
    );
    if (!upstream.ok) {
      console.error("[paper-chat] upstream rejected", {
        status: upstream.status,
        turns: messages.length,
      });
      throw new Error(`upstream-${upstream.status}`);
    }
    stage = "response-json";
    const data = await upstream.json();
    stage = "reply-content";
    const reply = parseProviderReply(
      data.choices?.[0]?.message?.content,
      messages.at(-1).content,
    );
    return res.status(200).json(reply);
  } catch (error) {
    console.error("[paper-chat] request failed", {
      stage,
      reason:
        error?.name === "TimeoutError"
          ? "timeout"
          : String(error?.message || "unknown").slice(0, 80),
      turns: messages.length,
    });
    return res
      .status(502)
      .json({ error: "暂时没连上，文字还在。可以重新试试，也可以先保存。" });
  }
}
