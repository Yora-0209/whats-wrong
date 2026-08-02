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
     沙画舞台:开屏「咋啦」凝聚 → 轻触后小人走入场景 → 走到终点
     ======================================================= */
  const Stage = (() => {
    const cv = $("sand");
    const ctx = cv.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const mouse = { x: -9999, y: -9999 };

    let W = 0, H = 0, raf = null, running = false, mode = "title", T = 0;

    /* ---------- 开屏「咋啦」粒子 ---------- */
    const REPEL = 96;
    const ink = ["rgba(74,68,58,0.92)", "rgba(107,124,92,0.9)", "rgba(124,154,107,0.9)"];
    const glowC = "rgba(207,155,75,0.95)";
    let tp = [], titleFade = 0, t0 = 0;

    function buildTitle() {
      if (!W || !H) return;
      const oc = document.createElement("canvas");
      oc.width = W; oc.height = H;
      const o = oc.getContext("2d");
      o.fillStyle = "#000"; o.textAlign = "center"; o.textBaseline = "middle";
      const fs = Math.min(W * 0.26, H * 0.30, 260);
      o.font = `500 ${fs}px "Songti SC","STSong","SimSun",serif`;
      o.fillText("咋啦", W / 2, H * 0.40);
      const data = o.getImageData(0, 0, W, H).data;
      const step = Math.max(4, Math.round(fs / 58));
      tp = [];
      for (let y = 0; y < H; y += step)
        for (let x = 0; x < W; x += step)
          if (data[(y * W + x) * 4 + 3] > 128)
            tp.push({
              x: W / 2 + (Math.random() - 0.5) * W, y: H / 2 + (Math.random() - 0.5) * H,
              tx: x, ty: y, vx: 0, vy: 0,
              s: Math.random() < 0.5 ? 1.4 : 2,
              c: Math.random() < 0.06 ? glowC : ink[(Math.random() * ink.length) | 0],
              ph: Math.random() * Math.PI * 2,
            });
    }
    function drawTitle(now) {
      const t = now - t0;
      for (const p of tp) {
        const jx = reduce ? 0 : Math.cos(p.ph + t * 0.0011) * 0.35;
        const jy = reduce ? 0 : Math.sin(p.ph + t * 0.0013) * 0.35;
        let ax = (p.tx + jx - p.x) * 0.022, ay = (p.ty + jy - p.y) * 0.022;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < REPEL * REPEL) { const d = Math.sqrt(d2) || 1, f = (1 - d / REPEL) * 4.2; ax += dx / d * f; ay += dy / d * f; }
        p.vx = (p.vx + ax) * 0.85; p.vy = (p.vy + ay) * 0.85;
        p.x += p.vx; p.y += p.vy;
        ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s);
      }
    }

    /* ---------- 走入场景:沙粒小人从近处走向「咋啦」(与首页重叠) ---------- */
    const SEASON = {
      spring: { fall: "petal", fc: "rgba(232,170,190,0.85)", grass: "#8fae72", n: 22 },
      summer: { fall: "pollen", fc: "rgba(207,155,75,0.85)", grass: "#7c9a6b", n: 18 },
      autumn: { fall: "leaf", fc: "rgba(201,120,52,0.9)", grass: "#b0975a", n: 24 },
      winter: { fall: "snow", fc: "rgba(255,255,255,0.92)", grass: "#c9ccc4", n: 34 },
    };
    let season, cfg, hs, grass = [], fallers = [], trail = [], wparts = [], hatch = [], walker = null;
    let sceneA = 0, revealed = false, walkStart = 0, goalGlow = 0;
    let goalY = 0, vpX = 0, nearY = 0;
    const FIG = [];

    function seasonNow() {
      const m = new Date().getMonth() + 1;
      return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
    }
    // 透视:t=0 近(大),t=1 到「咋啦」(远、小);lat 横向 -1..1
    function proj(t, lat) {
      t = clamp(t, 0, 1);
      const e = Math.pow(t, 0.7);
      const y = nearY - (nearY - goalY) * e;
      const scale = 1 - 0.74 * e;
      const x = vpX + lat * (W * 0.34) * scale;
      return { x, y, scale };
    }
    function newFaller(spread) {
      return {
        x: Math.random() * W, y: spread ? Math.random() * H : -12,
        vy: 0.4 + Math.random() * 0.9, vx: (Math.random() - 0.5) * 0.6,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.05,
        sz: (cfg.fall === "snow" || cfg.fall === "pollen" ? 2 : 5) * (0.7 + Math.random() * 0.8) * hs,
      };
    }
    // 采样"背影小人"局部粒子(妹岛和世/铅笔极简感:清瘦、头略大);密度更高更聚拢
    function buildFigure() {
      FIG.length = 0; let n = 0;
      while (FIG.length < 460 && n < 30000) {
        n++;
        const oy = Math.random() * 0.98, ox = (Math.random() - 0.5) * 0.44;
        let hw;
        if (oy < 0.62) hw = Math.max(0.045, 0.16 * (1 - Math.abs(oy - 0.3) / 0.55)); // 清瘦躯干
        else if (oy < 0.7) hw = 0.045;                                                // 细颈
        else { const dy = (oy - 0.84) / 0.15; const v = 1 - dy * dy; if (v <= 0) continue; hw = 0.15 * Math.sqrt(v); } // 略大的头
        if (Math.abs(ox) <= hw) FIG.push({ ox, oy });
      }
    }
    function initWalkerParts() {
      wparts = FIG.map((o) => ({
        x: vpX + (Math.random() - 0.5) * W, y: H * 0.5 + Math.random() * H * 0.6,
        ox: o.ox, oy: o.oy,
        // 铅笔石墨为主 + 少量鼠尾草绿 / 暖琥珀
        c: Math.random() < 0.08 ? "rgba(207,155,75,0.85)" : (Math.random() < 0.55 ? "rgba(84,84,78,0.9)" : "rgba(107,124,92,0.85)"),
      }));
    }
    function initScene() {
      season = seasonNow(); cfg = SEASON[season];
      hs = clamp(Math.min(W, H) / 820, 0.7, 1.3);
      goalY = H * 0.52; nearY = H * 1.0; vpX = W * 0.5;
      grass = [];
      if (season !== "winter") {
        for (let i = 0; i < 150; i++) grass.push({ lat: (Math.random() * 2 - 1) * 1.5, t: 0.05 + Math.random() * 0.92, ph: Math.random() * 6, two: Math.random() < 0.5 });
        grass.sort((a, b) => b.t - a.t);
      }
      // 铅笔排线肌理(统一斜向)
      hatch = [];
      for (let i = 0; i < 140; i++) hatch.push({ lat: (Math.random() * 2 - 1) * 1.6, t: 0.03 + Math.random() * 0.95, len: 6 + Math.random() * 10, ang: -0.5 + Math.random() * 0.2 });
      hatch.sort((a, b) => b.t - a.t);
      fallers = []; for (let i = 0; i < cfg.n; i++) fallers.push(newFaller(true));
      trail = []; revealed = false; sceneA = 0; goalGlow = 0;
      walker = { t: 0.02, steer: 0, steerTarget: 0, phase: 0, glance: 0 };
    }
    function enterWalk() {
      if (mode === "walk") return;
      mode = "walk";
      document.body.classList.add("walking");
      Sound.playOpen();
      initScene();
      walkStart = performance.now();
    }
    function arrive() {
      if (revealed) return;
      revealed = true;
      setTimeout(() => { setView("input"); setTimeout(() => $("feelingText").focus(), 300); }, 1300);
    }

    // 光之魂:一缕暖光飘向「咋啦」,沿途留下渐隐光尘
    function updateWalker(now) {
      const b = proj(walker.t, walker.steer);
      const cy = b.y - 30 * b.scale * hs;
      const over = mouse.x > 0 && Math.hypot(mouse.x - b.x, mouse.y - cy) < 60 * b.scale * hs + 30;
      if (revealed) { walker.glance = Math.min(1, walker.glance + 0.05); }
      else if (over) { walker.glance = Math.min(1, walker.glance + 0.08); } // 悬停:停下、变亮
      else {
        walker.glance = Math.max(0, walker.glance - 0.04);
        if (mouse.x > 0 && mouse.y > goalY - 60) walker.steerTarget = clamp((mouse.x - vpX) / (W * 0.34), -1, 1);
        else walker.steerTarget *= 0.95;
        walker.steer += (walker.steerTarget - walker.steer) * 0.05;
        walker.t += 0.0022 * (1 - 0.3 * walker.t);
        const s = b.scale * hs;
        trail.push({ x: b.x + (Math.random() - 0.5) * 4 * s, y: cy + (Math.random() - 0.5) * 4 * s, a: 1, r: (5 + Math.random() * 4) * s });
        if (trail.length > 150) trail.shift();
      }
      walker.phase += 0.05;
      if (!revealed && (walker.t > 0.85 || (now - walkStart > 20000 && walker.t > 0.55))) arrive();
    }

    function drawGround(now) {
      // 一层淡淡的地面
      const g = ctx.createLinearGradient(0, goalY, 0, H);
      g.addColorStop(0, "transparent"); g.addColorStop(1, "rgba(124,154,107,0.10)");
      ctx.fillStyle = g; ctx.fillRect(0, goalY, W, H - goalY);
      // 铅笔排线肌理
      ctx.strokeStyle = "rgba(95,110,80,0.07)"; ctx.lineWidth = 1;
      for (const h of hatch) {
        const p = proj(h.t, h.lat), s = p.scale * hs;
        if (s < 0.05) continue;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(h.ang) * h.len * s, p.y + Math.sin(h.ang) * h.len * s); ctx.stroke();
      }
    }
    function drawPath() {
      const n0 = proj(0, -0.2), n1 = proj(0, 0.2), fp = proj(0.9, 0);
      const lane = ctx.createLinearGradient(0, nearY, 0, goalY);
      lane.addColorStop(0, "rgba(255,252,242,0.45)"); lane.addColorStop(1, "rgba(255,252,242,0)");
      ctx.fillStyle = lane; ctx.beginPath(); ctx.moveTo(n0.x, n0.y); ctx.lineTo(n1.x, n1.y); ctx.lineTo(fp.x, fp.y); ctx.closePath(); ctx.fill();
    }
    function drawGrass(now) {
      ctx.lineCap = "round"; ctx.globalAlpha = 0.6;
      for (const b of grass) {
        const p = proj(b.t, b.lat), s = p.scale * hs;
        if (s < 0.05) continue;
        const sway = Math.sin(now * 0.001 + b.ph) * 3 * s;
        ctx.strokeStyle = b.two ? cfg.grass : "#6f8f60";
        ctx.lineWidth = 1.3 * s;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x + sway * 0.5, p.y - 8 * s, p.x + sway, p.y - 15 * s); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function drawFallers() {
      for (const f of fallers) {
        f.x += f.vx + Math.sin((f.y + T * 0.02) * 0.02) * 0.4; f.y += f.vy; f.rot += f.vr;
        if (f.y > H + 12) Object.assign(f, newFaller(false));
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.fillStyle = cfg.fc;
        if (cfg.fall === "snow" || cfg.fall === "pollen") { ctx.beginPath(); ctx.arc(0, 0, f.sz, 0, 7); ctx.fill(); }
        else if (cfg.fall === "petal") { ctx.beginPath(); ctx.ellipse(0, 0, f.sz, f.sz * 0.5, 0, 0, 7); ctx.fill(); }
        else ctx.fillRect(-f.sz / 2, -f.sz / 2, f.sz, f.sz * 0.7);
        ctx.restore();
      }
    }
    function drawTrail() {
      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i]; p.a -= 0.006;
        if (p.a <= 0) { trail.splice(i, 1); continue; }
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `rgba(240,201,120,${0.45 * p.a})`); g.addColorStop(1, "transparent");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      }
    }
    function drawGoalGlow() {
      if (goalGlow < 0.02) return;
      const g = ctx.createRadialGradient(vpX, goalY * 0.82, 0, vpX, goalY * 0.82, W * 0.3);
      g.addColorStop(0, `rgba(240,201,120,${0.22 * goalGlow})`); g.addColorStop(1, "transparent");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // 光之魂:一颗会呼吸的暖光,飘向「咋啦」
    function drawWalker(now) {
      const b = proj(walker.t, walker.steer);
      const s = Math.max(0.16, b.scale * hs);
      const cx = b.x, cy = b.y - 30 * s;
      const pulse = 1 + Math.sin(walker.phase * 3) * 0.08;
      const bright = 0.6 + 0.4 * walker.glance;
      // 外层光晕
      const R = 30 * s * pulse;
      let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, `rgba(246,221,176,${0.5 * bright})`);
      g.addColorStop(0.4, `rgba(207,155,75,${0.26 * bright})`);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
      // 明亮内核
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 9 * s);
      cg.addColorStop(0, `rgba(255,250,240,${0.95 * bright})`); cg.addColorStop(1, "rgba(246,221,176,0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, 9 * s, 0, 7); ctx.fill();
      // 环绕的小光点
      for (let k = 0; k < 3; k++) {
        const ang = walker.phase * 2 + k * 2.094;
        const sx = cx + Math.cos(ang) * 16 * s, sy = cy + Math.sin(ang) * 16 * s * 0.6;
        ctx.fillStyle = `rgba(255,240,200,${0.7 * bright})`;
        ctx.beginPath(); ctx.arc(sx, sy, 1.6 * s, 0, 7); ctx.fill();
      }
    }
    function drawFirefly(now) {
      if (mouse.x < 0) return;
      const r = (11 + Math.sin(now * 0.006) * 3) * hs;
      const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, r);
      g.addColorStop(0, "rgba(240,201,120,0.9)"); g.addColorStop(1, "rgba(240,201,120,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, r, 0, 7); ctx.fill();
    }
    function drawWalk(now) {
      sceneA += (1 - sceneA) * 0.04;
      if (revealed) goalGlow += (1 - goalGlow) * 0.04;
      ctx.save(); ctx.globalAlpha = sceneA;
      drawGround(now); drawPath(); drawGrass(now);
      ctx.restore();
      drawGoalGlow();
      drawTitle(now);                 // 「咋啦」始终在场,是光要去的地方
      updateWalker(now); drawTrail(); drawWalker(now);
      drawFallers();
      drawFirefly(now);
    }

    /* ---------- 循环 & 事件 ---------- */
    function resize() {
      W = cv.clientWidth; H = cv.clientHeight;
      const DPR = Math.min(2, window.devicePixelRatio || 1);
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function tick(now) {
      if (!running) return;
      T = now; ctx.clearRect(0, 0, W, H);
      if (mode === "title") drawTitle(now); else drawWalk(now);
      raf = requestAnimationFrame(tick);
    }
    function start() { if (running) return; resize(); buildTitle(); buildFigure(); running = true; t0 = performance.now(); raf = requestAnimationFrame(tick); }
    function reset() { document.body.classList.remove("walking"); mode = "title"; revealed = false; resize(); buildTitle(); }

    function onMove(e) {
      const pt = e.touches ? e.touches[0] : e, r = cv.getBoundingClientRect();
      mouse.x = pt.clientX - r.left; mouse.y = pt.clientY - r.top;
    }
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });
    cv.addEventListener("touchmove", onMove, { passive: true });
    cv.addEventListener("click", (e) => {
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (mode === "title") { enterWalk(); return; }
      if (revealed) return;
      const wp = proj(walker.t, walker.steer);
      if (Math.hypot(mx - wp.x, my - (wp.y - 70 * wp.scale * hs)) < 62 * wp.scale * hs + 20) { walker.glance = 1; return; } // 点小人:回眸
      if (my > goalY - 40) walker.steerTarget = clamp((mx - vpX) / (W * 0.34), -1, 1); // 点地面:改道
    });
    cv.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (mode === "title") enterWalk(); }
    });
    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (mode === "title") { resize(); buildTitle(); } else { resize(); } }, 200); });

    return { start, reset };
  })();

  Stage.start();

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
    setView("intro");   // 先切回首页,让画布重新可见(否则 clientWidth=0 会导致重建失败)
    Stage.reset();
  }

  /* ---------- 情绪地图 ---------- */
  $("toMapBtn").addEventListener("click", () => { renderMap(); setView("map"); });
  $("backHomeBtn").addEventListener("click", resetToHome);
  // 左上角返回键:输入页→首页;结果/地图页→输入页
  $("backBtn").addEventListener("click", () => {
    const v = document.body.getAttribute("data-view");
    if (v === "input") resetToHome();
    else if (v === "result" || v === "map") setView("input");
  });

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
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    $("calTitle").textContent = `${y} 年 ${m + 1} 月`;
    ["一", "二", "三", "四", "五", "六", "日"].forEach((w) => {
      const h = document.createElement("div"); h.className = "cal-h"; h.textContent = w; box.appendChild(h);
    });
    const offset = (new Date(y, m, 1).getDay() + 6) % 7; // 周一为首
    for (let i = 0; i < offset; i++) { const b = document.createElement("div"); b.className = "cal-b"; box.appendChild(b); }
    const days = new Date(y, m + 1, 0).getDate();
    const p = (n) => String(n).padStart(2, "0");
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${p(m + 1)}-${p(d)}`, hit = byDay[key];
      const cell = document.createElement("div"); cell.className = "cal-d"; cell.textContent = d;
      if (hit && hit.intensity > 0) { cell.dataset.i = String(Math.min(5, Math.max(1, hit.intensity))); cell.title = `${key} · ${hit.weather}`; }
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
