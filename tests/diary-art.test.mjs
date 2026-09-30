import test from "node:test";
import assert from "node:assert/strict";
import { ART_STYLE, validateBrief, validScene } from "../lib/diary-art.js";
import art from "../api/diary-art.js";
import brief from "../api/art-brief.js";
function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(value) {
      this.value = value;
      return this;
    },
  };
}
test("rejects invented evidence and malformed model output", () => {
  const source = "今天改了三遍方案";
  const b = {
    title: "改了又改",
    scene: "三张草稿纸",
    basis: "改了三遍方案",
    abstract: false,
  };
  assert.equal(validateBrief(b, source).scene, b.scene);
  assert.throws(() => validateBrief({ ...b, basis: "被领导批评" }, source));
  assert.throws(() => validateBrief({ ...b, abstract: "false" }, source));
  assert.equal(validScene("a".repeat(301)), false);
});
test("keeps scene-led colors and uses brand colors only as a fallback", () => {
  assert.match(ART_STYLE, /Follow colors stated or naturally suggested by the scene/);
  assert.match(ART_STYLE, /Only when the scene has no clear color cues/);
});
test("disabled image service does not make an upstream call", async () => {
  const old = process.env.DIARY_ART_ENABLED;
  delete process.env.DIARY_ART_ENABLED;
  const f = global.fetch;
  global.fetch = () => {
    throw new Error("must not call upstream");
  };
  try {
    const r = response();
    await art({ method: "POST", body: { scene: "纸张" } }, r);
    assert.equal(r.statusCode, 503);
    assert.equal(r.headers["Cache-Control"], "no-store");
    const s = response();
    await brief({ method: "POST", body: { text: "今天好累" } }, s);
    assert.equal(s.statusCode, 503);
  } finally {
    global.fetch = f;
    if (old === undefined) delete process.env.DIARY_ART_ENABLED;
    else process.env.DIARY_ART_ENABLED = old;
  }
});
test("malformed upstream image is rejected without exposing provider output", async () => {
  const keys = [
    "DIARY_ART_ENABLED",
    "IMAGE_BASE_URL",
    "IMAGE_API_KEY",
    "IMAGE_MODEL",
  ];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    DIARY_ART_ENABLED: "true",
    IMAGE_BASE_URL: "https://example.invalid/v1",
    IMAGE_API_KEY: "test-only",
    IMAGE_MODEL: "configured-model",
  });
  const f = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [{ b64_json: "bm90LWEtcG5n" }] }),
  });
  try {
    const r = response();
    await art({ method: "POST", body: { scene: "纸张" } }, r);
    assert.equal(r.statusCode, 502);
    assert.equal(JSON.stringify(r.value).includes("test-only"), false);
  } finally {
    global.fetch = f;
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
});
test("Seedream request normalizes host and persists PNG or JPEG base64", async () => {
  const config = { DIARY_ART_ENABLED: "true", IMAGE_API_KEY: "test-only", IMAGE_MODEL: "doubao-seedream-5-0-pro-260628", IMAGE_BASE_URL: "https://api.newcoin.top" };
  const old = Object.fromEntries(Object.keys(config).map(k => [k, process.env[k]]));
  const previousFetch = global.fetch;
  Object.assign(process.env, config);
  try {
    for (const [base, signature, mime] of [
      ["https://api.newcoin.top", "89504e470d0a1a0a", "png"],
      ["https://api.newcoin.top/v1/", "ffd8ff", "jpeg"],
    ]) {
      process.env.IMAGE_BASE_URL = base;
      global.fetch = async (url, options) => {
        assert.equal(url, "https://api.newcoin.top/v1/images/generations");
        const body = JSON.parse(options.body);
        assert.equal(body.model, config.IMAGE_MODEL);
        assert.equal(body.response_format, "b64_json");
        assert.equal(body.n, 1);
        assert.equal(body.size, "1024x1024");
        return { ok: true, json: async () => ({data:[{b64_json:Buffer.from(signature,"hex").toString("base64")}]}) };
      };
      const r = response();
      await art({method:"POST",body:{scene:"窗边的一张纸"}}, r);
      assert.equal(r.statusCode,200);
      assert.ok(r.value.image.startsWith(`data:image/${mime};base64,`));
    }
  } finally {
    global.fetch = previousFetch;
    for (const [k,v] of Object.entries(old)) {
      if(v === undefined) delete process.env[k]; else process.env[k]=v;
    }
  }
});
