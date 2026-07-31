/* 「咋啦」前端交互
   开屏抽屉 → 心灵漩涡浮现 → 投放 → 接住转化 → 收纳/焚毁 → 情绪地图
   数据只存本地(localStorage),不上传。LLM 通过 /api/chat 转发调用。 */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const setView = (v) => document.body.setAttribute("data-view", v);

  const MAP_KEY = "zala_map_v1";
  const MUTE_KEY = "zala_muted";
  let selectedPlace = "";

  /* =======================================================
     声音:用 WebAudio 现场合成柔和音效,无需任何音频文件
     ======================================================= */
  const Sound = (() => {
    let ctx = null;
    let muted = localStorage.getItem(MUTE_KEY) === "1";

    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ctx = new AC();
      }
      if (ctx && ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    // 柔和的开启音:一记温暖和弦 + 极轻的气流声
    function playOpen() {
      if (muted) return;
      const ac = ensure();
      if (!ac) return;
      const now = ac.currentTime;

      // 和弦(C-E-G,正弦,慢起长尾)
      const master = ac.createGain();
      master.gain.value = 0.0001;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 1800;
      master.connect(lp); lp.connect(ac.destination);
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.09, now + 0.5);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);

      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = ac.createOscillator();
        o.type = "sine"; o.frequency.value = f;
        const g = ac.createGain(); g.gain.value = i === 0 ? 1 : 0.7;
        o.connect(g); g.connect(master);
        o.start(now + i * 0.06); o.stop(now + 3.3);
      });

      // 一缕气流(带通噪声,一闪而过)
      const dur = 0.9;
      const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let k = 0; k < data.length; k++) data[k] = (Math.random() * 2 - 1) * 0.5;
      const noise = ac.createBufferSource(); noise.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 700; bp.Q.value = 0.8;
      const ng = ac.createGain(); ng.gain.value = 0.0001;
      noise.connect(bp); bp.connect(ng); ng.connect(ac.destination);
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.exponentialRampToValueAtTime(0.05, now + 0.25);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      bp.frequency.setValueAtTime(500, now);
      bp.frequency.linearRampToValueAtTime(1400, now + dur);
      noise.start(now); noise.stop(now + dur);
    }

    function setMuted(m) {
      muted = m;
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
      document.body.classList.toggle("muted", m);
    }
    function toggle() { setMuted(!muted); if (!muted) ensure(); }
    function init() { document.body.classList.toggle("muted", muted); }

    return { playOpen, toggle, init };
  })();

  Sound.init();
  $("soundToggle").addEventListener("click", Sound.toggle);

  /* =======================================================
     开屏:第一下拉开抽屉(漩涡+咋啦浮现),第二下走进来
     ======================================================= */
  const scene = $("portalScene");
  let introStage = "closed";

  function makeStars() {
    const box = $("stars");
    if (box.childElementCount) return;
    const tint = ["#ffffff", "#bcd8ff", "#e6d0ff", "#cfe9ff"];
    for (let i = 0; i < 64; i++) {
      const s = document.createElement("i");
      const size = (Math.random() * 2.4 + 0.8).toFixed(1);
      s.style.left = Math.random() * 100 + "%";
      s.style.top = Math.random() * 100 + "%";
      s.style.width = size + "px";
      s.style.height = size + "px";
      s.style.background = tint[(Math.random() * tint.length) | 0];
      s.style.animationDelay = (Math.random() * 4).toFixed(2) + "s";
      s.style.animationDuration = (2.5 + Math.random() * 3.5).toFixed(2) + "s";
      box.appendChild(s);
    }
  }

  function openPortal() {
    if (introStage !== "closed") return;
    introStage = "open";
    makeStars();
    scene.classList.add("opening");
    Sound.playOpen();
    const hint = $("introHint");
    hint.style.opacity = "0";
    setTimeout(() => { hint.textContent = "轻触，走进来"; hint.style.opacity = ""; }, 2600);
  }

  function enterInput() {
    setView("input");
    setTimeout(() => $("feelingText").focus(), 300);
  }

  scene.addEventListener("click", () => {
    if (introStage === "closed") openPortal();
    else enterInput();
  });
  scene.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (introStage === "closed") openPortal(); else enterInput();
    }
  });

  /* =======================================================
     语音输入(SpeechRecognition,支持则用,不支持则提示)
     ======================================================= */
  (function initVoice() {
    const micBtn = $("micBtn");
    const micLabel = $("micLabel");
    const DEFAULT_LABEL = "说给它听";
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    // 临时提示:显示几秒后自动恢复
    let hintTimer = null;
    function flash(msg, ms) {
      clearTimeout(hintTimer);
      micLabel.textContent = msg;
      hintTimer = setTimeout(() => { if (!listening) micLabel.textContent = DEFAULT_LABEL; }, ms || 3200);
    }

    if (!SR) {
      micBtn.classList.add("disabled");
      micBtn.addEventListener("click", () => flash("这台设备/浏览器不支持语音，建议用 Chrome"));
      return;
    }

    const rec = new SR();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = false;
    let listening = false;
    let baseText = "";
    let gotResult = false;

    micBtn.addEventListener("click", async () => {
      if (listening) { rec.stop(); return; }
      baseText = $("feelingText").value;
      gotResult = false;
      // 主动请求麦克风权限,好触发浏览器授权弹窗、并给出清晰反馈
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop()); // 仅用于取得授权
        } catch (err) {
          flash("请允许麦克风权限：点地址栏的麦克风图标 → 允许 → 重试", 5000);
          return;
        }
      }
      try { rec.start(); } catch (e) { /* 连点忽略 */ }
    });

    rec.onstart = () => {
      listening = true;
      micBtn.classList.add("listening");
      micLabel.textContent = "在听…（再点停止）";
    };
    rec.onerror = (e) => {
      const map = {
        "not-allowed": "麦克风被拦截：点地址栏麦克风图标→允许→刷新",
        "service-not-allowed": "麦克风被拦截：点地址栏麦克风图标→允许→刷新",
        "no-speech": "没听到声音，再说一次试试",
        "audio-capture": "没找到麦克风设备",
        "network": "语音服务连不上（此功能需能访问外网/开代理）",
        "aborted": DEFAULT_LABEL,
      };
      flash(map[e.error] || "语音出错了，稍后再试", 5000);
    };
    rec.onend = () => {
      listening = false;
      micBtn.classList.remove("listening");
      if (gotResult) micLabel.textContent = DEFAULT_LABEL;
      // 无结果时保留已有的错误提示(由 onerror 设置)
      else if (micLabel.textContent === "在听…（再点停止）") micLabel.textContent = DEFAULT_LABEL;
    };
    rec.onresult = (ev) => {
      gotResult = true;
      let txt = "";
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      const joiner = baseText && !/\s$/.test(baseText) ? baseText + " " : baseText;
      $("feelingText").value = (joiner + txt).slice(0, 600);
    };
  })();

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
    $("songTitle").textContent = dr.song ? `${dr.song.title} — ${dr.song.artist}` : "";
    $("songWhy").textContent = dr.song ? (dr.song.why || "") : "";
    if (dr.song && dr.song.title) {
      const q = encodeURIComponent(`${dr.song.title} ${dr.song.artist || ""}`.trim());
      $("songLink").href = `https://music.163.com/#/search/m/?s=${q}&type=1`;
      $("songLink").style.display = "inline-block";
    } else {
      $("songLink").style.display = "none";
    }
    $("stepAction").textContent = dr.step ? dr.step.action : "";
    $("stepPermission").textContent = dr.step ? (dr.step.permission || "") : "";
    $("wordsText").textContent = dr.words ? dr.words.text : "";
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
    scene.classList.remove("opening");
    introStage = "closed";
    $("introHint").textContent = "轻轻拉开";
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

    const placeCount = {};
    week.forEach((e) => { if (e.place) placeCount[e.place] = (placeCount[e.place] || 0) + 1; });
    let topPlace = "", topN = 0;
    Object.entries(placeCount).forEach(([p, n]) => { if (n > topN) { topPlace = p; topN = n; } });

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
