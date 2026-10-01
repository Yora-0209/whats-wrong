// Browser regression tests. AI replies below are TEST FIXTURES, never production fallbacks.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const root = path.resolve(__dirname, "..");
  const server = spawn(process.execPath, ["scripts/preview-server.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("server did not start")),
        10000,
      );
      server.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(Error("server exited " + code));
      });
    });
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE
        ? {
            executablePath: process.env.CHROMIUM_EXECUTABLE,
            args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
          }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1360, height: 980 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const base = "http://127.0.0.1:5173/";
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".garden").waitFor();
    assert.equal(await page.locator("#home-screen").isVisible(), true);
    assert.equal(
      await page.evaluate(() => document.fonts.check("18px PaperHand")),
      true,
    );
    assert.equal(
      await page.evaluate(() =>
        [...document.images].every((i) => i.complete && i.naturalWidth > 0),
      ),
      true,
    );
    const stable = async () => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(450);
    };
    const qa = path.join(root, "preview", "qa");
    fs.mkdirSync(qa, { recursive: true });
    await stable();
    await page.screenshot({
      path: path.join(qa, "desktop-home.png"),
      fullPage: true,
    });
    await page.locator(".object-journal").hover();
    await page.locator("#write").click();
    await page.locator("#feeling").fill("今天改了三遍方案，还是觉得不够好。");
    await page.locator("#send").click();
    await page.waitForFunction(() =>
      document.querySelector("#chat-status").textContent.includes("尚未连接"),
    );
    assert.equal(await page.locator(".utterance").count(), 1);
    await page.locator("#retry").click();
    await page.waitForFunction(() =>
      document.querySelector("#chat-status").textContent.includes("尚未连接"),
    );
    assert.equal(
      await page.locator(".utterance").count(),
      1,
      "retry must not duplicate user text",
    );
    let delayed;
    await page.route("**/api/paper-chat", (route) => {
      delayed = route;
    });
    await page.locator("#retry").click();
    await page.locator("#cancel-chat").waitFor();
    await page.locator("#cancel-chat").click();
    assert.equal(await page.locator(".utterance").count(), 1);
    assert.ok(
      (await page.locator("#chat-status").textContent()).includes("已停止等待"),
    );
    if (delayed) await delayed.abort().catch(() => {});
    await page.unroute("**/api/paper-chat");
    let requests = [];
    await page.route("**/api/paper-chat", (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          safety: "ok",
          echo: "改了好几遍，还是很难对自己满意。你可以先把这份疲惫写在这里。",
          suggestions: {
            music: {
              title: "适合慢慢停下来的声音",
              query: "睡前 放松 纯音乐",
              songs: [["Weightless", "Marconi Union"]],
            },
            movie: { title: "完美的日子", note: "慢慢看一会儿。" },
            action: { title: "松一松肩膀", detail: "把肩膀抬起再放下。" },
          },
        }),
      });
    });
    await page.locator("#retry").click();
    await page.locator("#continue").waitFor();
    assert.equal(await page.locator(".sticker").count(), 3);
    await page.locator(".sticker").first().locator("button").click();
    assert.equal(await page.locator(".sticker").first().locator("a").count(), 2);
    await page.locator("#continue").click();
    await page.locator("#feeling").fill("我怕最后还是让人失望。");
    await page.locator("#send").click();
    await page.locator("#continue").waitFor();
    assert.equal(
      requests.at(-1).messages.length,
      3,
      "follow-up must carry prior context",
    );
    assert.equal(await page.locator(".utterance").count(), 4);
    await stable();
    await page.screenshot({
      path: path.join(qa, "desktop-conversation.png"),
      fullPage: true,
    });
    await page.locator("#activity").click();
    await page.locator("#return-paper").click();
    assert.equal(
      await page.locator(".utterance").count(),
      4,
      "audio excursion retains conversation",
    );
    await page.locator("#finish").click();
    await page.locator("#save-conversation").click();
    await page.waitForURL("**/journal.html?entry=*");
    assert.ok(
      (await page.locator("#text").inputValue()).includes(
        "我怕最后还是让人失望。",
      ),
    );
    assert.equal(await page.locator(".entry").count(), 1);
    await page.locator("#saved-conversation summary").click();
    assert.equal(await page.locator("#saved-messages p").count(), 4);
    await page.locator("#title").fill("改了又改的一天");
    await page.locator("#save-all").click();
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("已保存在"),
    );
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector("#title").value === "改了又改的一天",
    );
    await page.locator("#art-toggle").click();
    await page.locator("#scene").fill("草稿纸和铅笔");
    await page.locator("#generate").click();
    await page.waitForFunction(() =>
      document.querySelector("#art-status").textContent.includes("尚未配置"),
    );
    assert.ok(
      (await page.locator("#text").inputValue()).includes("今天改了三遍方案"),
    );
    await page.locator("#save-all").click();
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("已保存在"),
    );
    await stable();
    await page.screenshot({
      path: path.join(qa, "desktop-journal.png"),
      fullPage: true,
    });
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await downloadPromise;
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    assert.equal(exported.entries.length, 1);
    assert.equal(exported.entries[0].conversation.length, 4);
    // Phone layout and native keyboard-capable entrances.
    await page.setViewportSize({ width: 390, height: 844 });
    await stable();
    await page.screenshot({
      path: path.join(qa, "mobile-journal.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator("#home").click();
    await page.waitForURL(base);
    await stable();
    await page.screenshot({
      path: path.join(qa, "mobile-home.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator("#listen").click();
    await page.locator("#play-audio").click();
    await page.waitForTimeout(500);
    const audioFeedback = await page.locator("#play-audio").textContent();
    assert.ok(
      audioFeedback === "暂停" ||
        (await page.locator("#audio-status").textContent()).length > 0,
    );
    await page.locator("#return-paper").click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator("#home-screen")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await page.unroute("**/api/paper-chat");
    await page.locator("#write").click();
    await page.locator("#feeling").fill("我不想活了");
    await page.locator("#send").click();
    await page.locator("#support").waitFor();
    assert.equal(await page.locator("#reply-actions").isVisible(), false);
    await page.locator("#finish").click();
    await page.locator("#discard-conversation").click();
    assert.equal(await page.locator("#home-screen").isVisible(), true);
    await page.locator(".object-journal").click();
    await page.waitForURL("**/journal.html");
    await page.locator(".entry").click();
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("#delete").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".entry").length === 0,
    );
    await page.reload();
    assert.equal(await page.locator(".entry").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: desktop/mobile layout, font/assets, failure+retry without duplication, context follow-up, audio return, save+reload, diary export+delete, disabled image service, explicit-signal support. AI success was mocked.",
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
