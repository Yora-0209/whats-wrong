/* 「咋啦」前端交互:开屏抽屉 → 投放 → 接住转化 → 收纳/焚毁 → 情绪地图
   数据只存本地(localStorage),不上传。LLM 通过 /api/chat 转发调用。 */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const setView = (v) => document.body.setAttribute("data-view", v);

  const MAP_KEY = "zala_map_v1";
  let selectedPlace = "";

  /* ---------- 开屏:拉开抽屉 ---------- */
  const cabinet = $("cabinet");
  function openCabinet() {
    if (cabinet.classList.contains("opening")) return;
    cabinet.classList.add("opening");
    $("introHint").style.opacity = "0";
    setTimeout(() => {
      setView("input");
      $("feelingText").focus();
    }, 900);
  }
  cabinet.addEventListener("click", openCabinet);
  cabinet.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCabinet(); }
  });

  /* ---------- 地点标签 ---------- */
  $("placeChips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    const p = btn.dataset.place;
    if (selectedPlace === p) {
      selectedPlace = "";
      btn.classList.remove("active");
    } else {
      selectedPlace = p;
      document.querySelectorAll("#placeChips .chip").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
    }
  });

  /* ---------- 投放 → 接住 ---------- */
  const loadingWords = ["正在接住……", "别急，我在。", "慢慢来。"];
  $("submitBtn").addEventListener("click", handleSubmit);

  async function handleSubmit() {
    const text = $("feelingText").value.trim();
    if (!text) { $("feelingText").focus(); return; }

    setView("loading");
    let i = 0;
    $("loadingWord").textContent = loadingWords[0];
    const rotate = setInterval(() => {
      i = (i + 1) % loadingWords.length;
      $("loadingWord").textContent = loadingWords[i];
    }, 1400);

    let data;
    try {
      data = await callZala({ text, place: selectedPlace, time: new Date().toISOString() });
    } catch (err) {
      data = mockResponse(text); // 无后端/失败时的降级,保证体验可见
    }
    clearInterval(rotate);
    renderResult(data, text);
  }

  async function callZala(payload) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("bad status " + res.status);
    return await res.json();
  }

  /* ---------- 渲染接住 + 出口 ---------- */
  let lastResult = null;

  function renderResult(d, sourceText) {
    lastResult = { d, sourceText, place: selectedPlace, at: Date.now() };
    document.body.classList.toggle("crisis", d.safety === "crisis");

    $("echoText").textContent = d.echo || "我在。";
    $("emotionText").textContent = d.emotion ? "— " + d.emotion : "";
    $("weatherChip").textContent = d.weather || "";

    if (d.safety === "crisis") {
      injectCrisisHelp();
      setView("result");
      return;
    }
    removeCrisisHelp();

    const dr = d.drawers || {};
    // 歌
    $("songTitle").textContent = dr.song ? `${dr.song.title} — ${dr.song.artist}` : "";
    $("songWhy").textContent = dr.song ? (dr.song.why || "") : "";
    if (dr.song && dr.song.title) {
      const q = encodeURIComponent(`${dr.song.title} ${dr.song.artist || ""}`.trim());
      $("songLink").href = `https://music.163.com/#/search/m/?s=${q}&type=1`;
      $("songLink").style.display = "inline-block";
    } else {
      $("songLink").style.display = "none";
    }
    // 一件小事
    $("stepAction").textContent = dr.step ? dr.step.action : "";
    $("stepPermission").textContent = dr.step ? (dr.step.permission || "") : "";
    // 一句话
    $("wordsText").textContent = dr.words ? dr.words.text : "";
    // 宣泄
    $("releaseAction").textContent = dr.release ? dr.release.action : "";

    setView("result");
  }

  function injectCrisisHelp() {
    removeCrisisHelp();
    const box = document.createElement("div");
    box.className = "crisis-help";
    box.id = "crisisHelp";
    box.innerHTML = '这件事，别一个人扛。<br/>希望24热线 <strong>400-161-9995</strong><br/><span style="font-size:12px;opacity:.7">（24小时，随时可以打）</span>';
    $("drawersWrap").after(box);
  }
  function removeCrisisHelp() {
    const el = $("crisisHelp");
    if (el) el.remove();
  }

  /* ---------- 收进地图 / 焚毁 ---------- */
  $("keepBtn").addEventListener("click", () => {
    if (!lastResult) return;
    const map = loadMap();
    map.unshift({
      at: lastResult.at,
      weather: lastResult.d.weather || "",
      emotion: lastResult.d.emotion || "",
      place: lastResult.place || "",
      intensity: lastResult.d.intensity || null,
    });
    localStorage.setItem(MAP_KEY, JSON.stringify(map.slice(0, 500)));
    resetToHome();
  });

  $("burnBtn").addEventListener("click", () => {
    document.body.classList.add("burning");
    setTimeout(() => {
      document.body.classList.remove("burning");
      resetToHome();
    }, 900);
  });

  function resetToHome() {
    $("feelingText").value = "";
    selectedPlace = "";
    document.querySelectorAll("#placeChips .chip").forEach((c) => c.classList.remove("active"));
    document.body.classList.remove("crisis");
    cabinet.classList.remove("opening");
    $("introHint").style.opacity = "";
    setView("intro");
  }

  /* ---------- 情绪地图 ---------- */
  $("toMapBtn").addEventListener("click", () => { renderMap(); setView("map"); });
  $("backHomeBtn").addEventListener("click", resetToHome);

  function loadMap() {
    try { return JSON.parse(localStorage.getItem(MAP_KEY)) || []; }
    catch { return []; }
  }

  function renderMap() {
    const map = loadMap();
    $("mapSub").textContent = map.length
      ? `已经收进 ${map.length} 个瞬间。`
      : "这里只留你亲手收进来的。";
    renderWeeklyEcho(map);
    renderHeatmap(map);
    renderMapList(map);
  }

  // 本周回响:只回看,不预测。攒够 3 条才出现,零伪规律。
  function renderWeeklyEcho(map) {
    const box = $("echoWeek");
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const week = map.filter((e) => e.at >= weekAgo);
    if (week.length < 3) { box.hidden = true; return; }

    // 最常去的地方
    const placeCount = {};
    week.forEach((e) => { if (e.place) placeCount[e.place] = (placeCount[e.place] || 0) + 1; });
    let topPlace = "", topN = 0;
    Object.entries(placeCount).forEach(([p, n]) => { if (n > topN) { topPlace = p; topN = n; } });

    // 最沉的一次
    let heavy = null;
    week.forEach((e) => { if (!heavy || (Number(e.intensity) || 0) > (Number(heavy.intensity) || 0)) heavy = e; });

    const lines = [`这一周，你来过 ${week.length} 次。`];
    if (topN >= 2 && topPlace) lines.push(`有 ${topN} 次，都在「${topPlace}」。`);
    const heavyWeather = heavy && (heavy.weather || heavy.emotion);
    if (heavyWeather && (Number(heavy.intensity) || 0) >= 4) lines.push(`最沉的一次，是「${heavyWeather}」。`);
    lines.push("我都记得。");

    box.innerHTML =
      '<div class="ew-title">本周回响</div>' +
      '<div class="ew-body">' + lines.map(escapeHtml).join("<br/>") + "</div>";
    box.hidden = false;
  }

  // 按天聚合:每天取最强的一次情绪(强度)与其天气
  function renderHeatmap(map) {
    const box = $("heatmap");
    box.innerHTML = "";

    const byDay = {};
    map.forEach((e) => {
      const key = dayKey(new Date(e.at));
      const inten = Number(e.intensity) || 0;
      if (!byDay[key] || inten > byDay[key].intensity) {
        byDay[key] = { intensity: inten, weather: e.weather || e.emotion || "" };
      }
    });

    const WEEKS = 12;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // 回溯到 WEEKS*7 天前,再对齐到那周的周一
    const start = new Date(today);
    start.setDate(start.getDate() - (WEEKS * 7 - 1));
    const backToMon = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - backToMon);

    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d);
      const cell = document.createElement("div");
      cell.className = "heat-cell";
      const hit = byDay[key];
      if (hit && hit.intensity > 0) {
        cell.dataset.i = String(Math.min(5, Math.max(1, hit.intensity)));
        cell.title = `${key} · ${hit.weather}`;
      } else {
        cell.title = key;
      }
      box.appendChild(cell);
    }
  }

  function renderMapList(map) {
    const list = $("mapList");
    list.innerHTML = "";
    if (!map.length) {
      list.innerHTML = '<p class="map-empty">还空着。<br/>下次想留住某个瞬间，就把它收进来。</p>';
      return;
    }
    map.forEach((e) => {
      const row = document.createElement("div");
      row.className = "map-entry";
      row.innerHTML =
        `<span class="map-when">${fmtDate(e.at)}</span>` +
        `<span class="map-weather">${escapeHtml(e.weather || e.emotion || "—")}</span>` +
        `<span class="map-place">${escapeHtml(e.place || "")}</span>`;
      list.appendChild(row);
    });
  }

  function dayKey(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- 降级 mock(本地直接打开、或后端未配置时) ---------- */
  function mockResponse(text) {
    return {
      safety: "ok",
      echo: "这一天，听起来像是被什么东西轻轻压着，喘不太上气。",
      emotion: "说不清的闷",
      intensity: 3,
      weather: "低气压的阴天",
      mode: "stay",
      drawers: {
        song: { title: "夜空中最亮的星", artist: "逃跑计划", why: "适合一个人待着的夜里" },
        step: { action: "去接一杯温水，慢慢喝完", permission: "就这一件，喝完可以停" },
        words: { text: "你不用现在就想明白，先喘口气。" },
        release: { action: "把最堵的那句话打出来，然后删掉它" },
      },
    };
  }
})();
