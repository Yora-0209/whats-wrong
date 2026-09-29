import {
  ART_STYLE,
  STYLE_VERSION,
  validScene,
  parseBody,
  noStore,
} from "../lib/diary-art.js";
export default async function handler(req, res) {
  noStore(res);
  const { IMAGE_BASE_URL, IMAGE_API_KEY, IMAGE_MODEL } = process.env;
  const enabled =
    process.env.DIARY_ART_ENABLED === "true" &&
    !!IMAGE_BASE_URL &&
    !!IMAGE_API_KEY &&
    !!IMAGE_MODEL;
  if (req.method === "GET")
    return res.status(200).json({ enabled, styleVersion: STYLE_VERSION });
  if (req.method !== "POST")
    return res.status(405).json({ error: "仅支持 POST" });
  if (!enabled)
    return res
      .status(503)
      .json({ error: "真实生图服务尚未配置。文字记录可以正常保存。" });
  let body;
  try {
    body = parseBody(req);
  } catch {
    return res.status(400).json({ error: "请求格式不正确" });
  }
  if (!validScene(body.scene))
    return res.status(400).json({ error: "画面描述需为 1–300 字" });
  try {
    // OpenAI-compatible image generation; the configured model is never substituted.
    const base = IMAGE_BASE_URL.trim().replace(/\/+$/, "");
    const endpoint = `${base}${new URL(base).pathname === "/" ? "/v1" : ""}/images/generations`;
    const response = await fetch(
      endpoint,
      {
        method: "POST",
        signal: AbortSignal.timeout(90000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${IMAGE_API_KEY}`,
        },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          prompt: `${ART_STYLE}\nScene data: ${JSON.stringify(body.scene)}`,
          n: 1,
          size: "1024x1024",
          response_format: "b64_json",
        }),
      },
    );
    if (!response.ok) throw new Error("upstream");
    const payload = await response.json();
    const b64 = payload.data?.[0]?.b64_json;
    if (
      typeof b64 !== "string" ||
      b64.length > 4000000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)
    )
      throw new Error("invalid image");
    const bytes = Buffer.from(b64, "base64");
    const mime = bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
      ? "image/png"
      : bytes.subarray(0, 3).toString("hex") === "ffd8ff"
        ? "image/jpeg" : null;
    if (!mime) throw new Error("expected PNG or JPEG");
    return res
      .status(200)
      .json({
        image: `data:${mime};base64,${b64}`,
        styleVersion: STYLE_VERSION,
      });
  } catch {
    return res
      .status(502)
      .json({
        error: "小画暂时没有生成成功。文字和原来的配图都还在，请稍后重试。",
      });
  }
}
