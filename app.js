/* 「咋啦」前端交互
   开屏抽屉 → 心灵漩涡浮现 → 投放 → 接住转化 → 收纳/焚毁 → 情绪地图
   数据只存本地(localStorage),不上传。LLM 通过 /api/chat 转发调用。 */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const setView = (v) => document.body.setAttribute("data-view", v);

  const MAP_KEY = "zala_map_v1";
  const MUTE_KEY = "zala_muted";
  const ECHO_KEY = "zala_echo_v1";          // { lastShownDay: "YYYY-MM-DD" } 每日只自动回响一次
  const TASK_KEY = "zala_tasks_v1";         // 收下的「一件小事」
  const LOCK_KEY = "zala_lock_v1";          // { hash } 地图访问密码(仅防随手翻看)
  const DAY = 24 * 3600 * 1000;
  const HOUR = 3600 * 1000;
  const ECHO_MIN_AGE = 7 * DAY;             // 记录满 7 天才有资格回响(需要时间距离)
  const ECHO_REPEAT_GAP = 14 * DAY;         // 同一条回响后至少隔 14 天才会再次浮现
  const MILESTONES = [7, 30, 100, 365];     // 优先在这些天数节点回响
  const TASK_FOLLOWUP_AGE = 3 * HOUR;       // 收下小事 3 小时后才回访(给时间去做)
  const TASK_SNOOZE = 6 * HOUR;             // 「还没」后至少隔 6 小时再问
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

    /* 环境轻音乐:程序化柔和 pad,只在鼠标移动/点击/滚动时渐起,静止即渐隐 */
    let ambient = null, idleTimer = null;
    const AMB_LEVEL = 0.11;
    function ensureAmbient() {
      const ac = ensure();
      if (!ac) return null;
      if (ambient) return ambient;
      const out = ac.createGain(); out.gain.value = 0.0001;
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 820; lp.Q.value = 0.3;
      const lfo = ac.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.05;
      const lfoGain = ac.createGain(); lfoGain.gain.value = 220;
      lfo.connect(lfoGain); lfoGain.connect(lp.frequency); lfo.start();
      out.connect(lp); lp.connect(ac.destination);
      // C 大调九和弦味道的低八度铺底,多把微失谐震荡叠出温润的呼吸感
      [130.81, 196.00, 261.63, 329.63, 392.00].forEach((f, i) => {
        [0, 0.5, -0.5].forEach((det) => {
          const o = ac.createOscillator();
          o.type = i < 2 ? "triangle" : "sine";
          o.frequency.value = f; o.detune.value = det;
          const g = ac.createGain(); g.gain.value = 0.14 / (i + 1);
          o.connect(g); g.connect(out); o.start();
        });
      });
      ambient = { out };
      return ambient;
    }
    // 拉起音量,并安排静止后渐隐(仅在 ctx 已运行时执行,避免挂起期的时钟错乱)
    function rampUp(ac) {
      const amb = ensureAmbient(); if (!amb) return;
      const now = ac.currentTime;
      amb.out.gain.cancelScheduledValues(now);
      amb.out.gain.setTargetAtTime(AMB_LEVEL, now, 0.18);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const t = ac.currentTime;
        amb.out.gain.cancelScheduledValues(t);
        amb.out.gain.setTargetAtTime(0.0001, t, 0.6);
      }, 480);
    }
    // 有鼠标移动/点击/滚动时:柔和拉起音量;静止约 0.5s 后:渐隐至无声。
    // 浏览器自动播放策略要求首个"真实手势"(点击/触摸/按键)才能解锁音频,
    // 因此挂起时先 resume,待真正 running 后再起音。
    function activity() {
      if (muted) return;
      const ac = ensure(); if (!ac) return;
      if (ac.state !== "running") {
        if (ac.resume) ac.resume().then(() => { if (!muted) rampUp(ac); }).catch(() => {});
        return;
      }
      rampUp(ac);
    }
    function silenceAmbient() {
      clearTimeout(idleTimer);
      if (ambient && ctx) {
        const t = ctx.currentTime;
        ambient.out.gain.cancelScheduledValues(t);
        ambient.out.gain.setTargetAtTime(0.0001, t, 0.2);
      }
    }

    function setMuted(m) {
      muted = m;
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
      document.body.classList.toggle("muted", m);
      if (m) silenceAmbient();
    }
    function toggle() { setMuted(!muted); if (!muted) ensure(); }
    function init() { document.body.classList.toggle("muted", muted); }


    return { playOpen, toggle, init, activity };
  })();

  Sound.init();
  $("soundToggle").addEventListener("click", Sound.toggle);
  // 全站:鼠标移动/点击/滚动才响起轻音乐,页面静止则无声
  ["pointermove", "pointerdown", "wheel", "touchstart", "keydown"].forEach((ev) =>
    window.addEventListener(ev, Sound.activity, { passive: true })
  );

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

    function buildTitle(ox, oy) {
      if (!W || !H) return;
      const useO = ox != null;
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
          if (data[(y * W + x) * 4 + 3] > 128) {
            const ang = Math.random() * 6.283, spd = useO ? 1.5 + Math.random() * 3.5 : 0;
            tp.push({
              // 「让它消失」时:沙从卡片处先向外迸散,再缓缓聚成「咋啦」
              x: useO ? ox + (Math.random() - 0.5) * 40 : W / 2 + (Math.random() - 0.5) * W,
              y: useO ? oy + (Math.random() - 0.5) * 40 : H / 2 + (Math.random() - 0.5) * H,
              tx: x, ty: y,
              vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              s: Math.random() < 0.5 ? 1.4 : 2,
              c: Math.random() < 0.06 ? glowC : ink[(Math.random() * ink.length) | 0],
              ph: Math.random() * Math.PI * 2,
            });
          }
    }
    function drawTitle(now) {
      const t = now - t0;
      for (const p of tp) {
        const jx = reduce ? 0 : Math.cos(p.ph + t * 0.0011) * 0.35;
        const jy = reduce ? 0 : Math.sin(p.ph + t * 0.0013) * 0.35;
        let ax = (p.tx + jx - p.x) * 0.018, ay = (p.ty + jy - p.y) * 0.018;
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
    let season, cfg, hs, grass = [], fallers = [], trail = [], sparks = [], wparts = [], hatch = [], walker = null;
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
      walker = { t: 0.02, steer: 0, steerTarget: 0, phase: 0, glance: 0, rush: false };
      sparks = [];
      for (let i = 0; i < 15; i++) sparks.push({ ox: Math.random() * 2 - 1, oy: Math.random() * 2 - 1, ph: Math.random() * 6.28, rr: 0.4 + Math.random() * 0.6 });
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
      setTimeout(() => {
        // 地图上了锁又没解锁时,不自动浮现回响(回响会露出过去的私密内容)
        const cand = (hasLock() && !mapUnlocked) ? null : pickEchoCandidate();
        if (cand) { openEcho(cand, "enter"); }
        else { setView("input"); setTimeout(() => $("feelingText").focus(), 300); maybePromptTask(); }
      }, 1300);
    }

    // 光之魂:一小簇会闪的光斑,飘向「咋啦」;点击可立即抵达
    function updateWalker(now) {
      const b = proj(walker.t, walker.steer);
      const cy = b.y - 30 * b.scale * hs;
      const s = b.scale * hs;
      walker.phase += 0.08;
      if (revealed) return;
      if (walker.rush) {
        walker.glance = Math.min(1, walker.glance + 0.1);
        walker.t += 0.05;
        trail.push({ x: b.x, y: cy, a: 1, r: (5 + Math.random() * 4) * s });
        if (trail.length > 150) trail.shift();
        if (walker.t > 0.9) arrive();
        return;
      }
      const over = mouse.x > 0 && Math.hypot(mouse.x - b.x, mouse.y - cy) < 60 * s + 30;
      if (over) { walker.glance = Math.min(1, walker.glance + 0.08); } // 悬停:停下、变亮
      else {
        walker.glance = Math.max(0, walker.glance - 0.04);
        if (mouse.x > 0 && mouse.y > goalY - 60) walker.steerTarget = clamp((mouse.x - vpX) / (W * 0.34), -1, 1);
        else walker.steerTarget *= 0.95;
        walker.steer += (walker.steerTarget - walker.steer) * 0.05;
        walker.t += 0.003 * (1 - 0.3 * walker.t);
        trail.push({ x: b.x + (Math.random() - 0.5) * 4 * s, y: cy + (Math.random() - 0.5) * 4 * s, a: 1, r: (5 + Math.random() * 4) * s });
        if (trail.length > 150) trail.shift();
      }
      if (walker.t > 0.85 || (now - walkStart > 16000 && walker.t > 0.55)) arrive();
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
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i]; p.a -= 0.008;
        if (p.a <= 0) { trail.splice(i, 1); continue; }
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `rgba(255,240,205,${0.4 * p.a})`); g.addColorStop(1, "transparent");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
    function drawGoalGlow() {
      if (goalGlow < 0.02) return;
      const g = ctx.createRadialGradient(vpX, goalY * 0.82, 0, vpX, goalY * 0.82, W * 0.3);
      g.addColorStop(0, `rgba(240,201,120,${0.22 * goalGlow})`); g.addColorStop(1, "transparent");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // 光之魂:一小簇会闪的细碎光斑(叠加发光、通透)
    function drawWalker(now) {
      const b = proj(walker.t, walker.steer);
      const s = Math.max(0.16, b.scale * hs);
      const cx = b.x, cy = b.y - 30 * s;
      const bright = 0.7 + 0.3 * walker.glance;
      const R = 22 * s;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      // 柔和整体光晕
      let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.7);
      g.addColorStop(0, `rgba(255,246,220,${0.2 * bright})`); g.addColorStop(1, "transparent");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, 0, 7); ctx.fill();
      // 细碎光斑(各自闪烁、轻微游移)
      for (const sp of sparks) {
        const fl = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(walker.phase * 1.6 + sp.ph * 3));
        const px = cx + sp.ox * R * sp.rr + Math.cos(walker.phase * 0.5 + sp.ph) * 2 * s;
        const py = cy + sp.oy * R * sp.rr + Math.sin(walker.phase * 0.5 + sp.ph) * 2 * s;
        const rr = (1.4 + sp.rr * 1.6) * s;
        const gg = ctx.createRadialGradient(px, py, 0, px, py, rr * 2.6);
        gg.addColorStop(0, `rgba(255,250,235,${0.9 * fl * bright})`);
        gg.addColorStop(0.5, `rgba(244,222,172,${0.36 * fl * bright})`);
        gg.addColorStop(1, "transparent");
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(px, py, rr * 2.6, 0, 7); ctx.fill();
      }
      ctx.restore();
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
    function reset(o) { document.body.classList.remove("walking"); mode = "title"; revealed = false; resize(); if (o) buildTitle(o.x, o.y); else buildTitle(); }

    function onMove(e) {
      const pt = e.touches ? e.touches[0] : e, r = cv.getBoundingClientRect();
      mouse.x = pt.clientX - r.left; mouse.y = pt.clientY - r.top;
    }
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });
    cv.addEventListener("touchmove", onMove, { passive: true });
    cv.addEventListener("click", () => {
      if (mode === "title") { enterWalk(); return; }
      if (!revealed && walker) walker.rush = true; // 点击任意处:光立即飞向「咋啦」
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
  $("submitBtn").addEventListener("click", () => handleSubmit());
  // 极速投放:说不出时,点一下当下的心情,也能被接住
  $("quickMoods").addEventListener("click", (e) => {
    const btn = e.target.closest(".mood");
    if (btn) handleSubmit(btn.dataset.mood);
  });

  async function handleSubmit(overrideText) {
    const text = (typeof overrideText === "string" ? overrideText : $("feelingText").value).trim();
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
    $("sealOpts").hidden = true;
    $("sealToggle").classList.remove("open");

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
    // 一件小事:重置「收下」按钮
    stepTaken = false;
    const takeBtn = $("stepTakeBtn");
    if (dr.step && dr.step.action) {
      takeBtn.hidden = false; takeBtn.disabled = false;
      takeBtn.classList.remove("taken"); takeBtn.textContent = "收下这件小事";
    } else {
      takeBtn.hidden = true;
    }
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
  function saveMap(map) {
    localStorage.setItem(MAP_KEY, JSON.stringify(map.slice(0, 500)));
  }

  // 收进地图。openAt 非空 = 「封存给未来」,到期才会浮现回响。
  // 注:text 仅保存在本地(localStorage),用于日后回响;「让它消失」焚毁的记录永不保存。
  function keepEntry(openAt) {
    if (!lastResult) return;
    const map = loadMap();
    map.unshift({
      id: lastResult.at,
      at: lastResult.at,
      text: (lastResult.sourceText || "").slice(0, 600),
      echo: lastResult.d.echo || "",
      weather: lastResult.d.weather || "",
      emotion: lastResult.d.emotion || "",
      place: lastResult.place || "",
      intensity: lastResult.d.intensity || null,
      openAt: openAt || null,
      echoedAt: null,
      responses: [],
    });
    saveMap(map);
    resetToHome();
  }

  $("keepBtn").addEventListener("click", () => keepEntry(null));

  // 封存给未来的自己:展开档位 → 选一个 → 记 openAt
  $("sealToggle").addEventListener("click", () => {
    $("sealOpts").hidden = !$("sealOpts").hidden;
    $("sealToggle").classList.toggle("open", !$("sealOpts").hidden);
  });
  $("sealOpts").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    const key = btn.dataset.seal;
    let openAt;
    if (key === "year") { const d = new Date(); d.setFullYear(d.getFullYear() + 1); openAt = d.getTime(); }
    else openAt = Date.now() + Number(key) * DAY;
    keepEntry(openAt);
  });

  /* ---------- 「让它消失」:接住卡就地化作沙,缓缓聚回首页「咋啦」 ---------- */
  $("burnBtn").addEventListener("click", () => {
    if (document.body.classList.contains("dissolving")) return;
    const card = $("echoCard"), r = card.getBoundingClientRect();
    const ox = r.left + r.width / 2, oy = r.top + r.height / 2; // 卡片中心 = 沙的迸发点
    document.body.classList.add("dissolving");
    card.classList.add("dissolve");
    setTimeout(() => {
      card.classList.remove("dissolve");
      document.body.classList.remove("dissolving");
      resetToHome({ x: ox, y: oy });   // 沙从卡片处升起,缓缓聚成「咋啦」
    }, 520);
  });

  function resetToHome(origin) {
    $("feelingText").value = "";
    selectedPlace = "";
    document.querySelectorAll("#placeChips .chip").forEach((c) => c.classList.remove("active"));
    window.scrollTo(0, 0);
    document.body.classList.remove("crisis");
    setView("intro");   // 先切回首页,让画布重新可见(否则 clientWidth=0 会导致重建失败)
    Stage.reset(origin);
  }
  /* ---------- 情绪地图 ---------- */
  $("toMapBtn").addEventListener("click", goMap);
  $("backHomeBtn").addEventListener("click", resetToHome);
  // 左上角返回键:输入页→首页;结果/地图页→输入页
  $("backBtn").addEventListener("click", () => {
    const v = document.body.getAttribute("data-view");
    if (v === "input") resetToHome();
    else if (v === "echo") closeEcho(false);
    else if (v === "lock") resetToHome();
    else if (v === "result" || v === "map") { setView("input"); window.scrollTo(0, 0); maybePromptTask(); }
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
    const now = Date.now();
    map.forEach((e) => {
      // 封存中:不泄露内容,只显示一枚待亮起的胶囊
      if (e.openAt && e.openAt > now) {
        const left = Math.max(1, Math.ceil((e.openAt - now) / DAY));
        const cap = document.createElement("div");
        cap.className = "map-entry sealed";
        cap.innerHTML = `<div class="map-row-main"><span class="seal-ico">✦</span>` +
          `<span class="seal-text">一枚封存的胶囊 · 还有 ${left} 天亮起</span></div>`;
        list.appendChild(cap);
        return;
      }
      const hasEcho = e.responses && e.responses.length;
      const row = document.createElement("div");
      row.className = "map-entry" + (e.text ? " tappable" : "") + (hasEcho ? " has-echo" : "");
      if (e.id != null) row.dataset.id = String(e.id);
      const note = hasEcho
        ? `<div class="map-echo-note">回响 · ${escapeHtml(e.responses[e.responses.length - 1].text)}</div>` : "";
      row.innerHTML =
        `<div class="map-row-main">` +
          `<span class="map-when">${fmtDate(e.at)}</span>` +
          `<span class="map-weather">${escapeHtml(e.weather || e.emotion || "—")}</span>` +
          `<span class="map-place">${escapeHtml(e.place || "")}</span>` +
        `</div>` + note;
      list.appendChild(row);
    });
  }

  // 点地图里有原文的记录 → 重新打开它的回响
  $("mapList").addEventListener("click", (e) => {
    const row = e.target.closest(".map-entry.tappable");
    if (!row) return;
    const id = Number(row.dataset.id);
    const entry = loadMap().find((x) => x.id === id);
    if (entry) openEcho(entry, "map");
  });

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

  /* =======================================================
     回响 · 时间胶囊:把过去收进来的情绪,在合适的时机温柔地递还
     ======================================================= */
  let echoContext = null;  // { id, from: "enter" | "map" }

  function loadEchoState() {
    try { return JSON.parse(localStorage.getItem(ECHO_KEY)) || {}; }
    catch { return {}; }
  }
  function echoShownToday() { return loadEchoState().lastShownDay === dayKey(new Date()); }
  function markEchoShownToday() {
    localStorage.setItem(ECHO_KEY, JSON.stringify({ lastShownDay: dayKey(new Date()) }));
  }

  // 选一条可回响的记录:仅限本地保存过原文、未焚毁的;
  // 封存到期的最优先,其次挑最接近节点(7/30/100/365天)的旧记录。每天最多一次。
  function pickEchoCandidate() {
    if (echoShownToday()) return null;
    const now = Date.now();
    const eligible = loadMap().filter((e) => {
      if (!e || !e.text) return false;                                    // 老数据/无原文
      if (e.openAt && e.openAt > now) return false;                       // 还在封存期
      if (e.echoedAt && now - e.echoedAt < ECHO_REPEAT_GAP) return false; // 最近刚回响过
      const sealedDue = e.openAt && e.openAt <= now && !e.echoedAt;
      return sealedDue || (now - e.at >= ECHO_MIN_AGE);
    });
    if (!eligible.length) return null;
    const score = (e) => {
      let s = (e.openAt && e.openAt <= now) ? 1000 : 0;
      const days = (now - e.at) / DAY;
      s += Math.max(0, 40 - Math.min.apply(null, MILESTONES.map((m) => Math.abs(days - m))));
      return s;
    };
    eligible.sort((a, b) => score(b) - score(a));
    return eligible[0];
  }

  function mockEchoLine(days) {
    if (days >= 300) return "快一年了。那时的你,大概想不到能走到这里。";
    if (days >= 80) return "那阵子的沉,现在再看,是不是轻了一点点。";
    if (days >= 25) return "一个月了。你还在往前走,这就够了。";
    return "过了些天了。回头看看那时的自己,别太苛刻。";
  }

  async function fetchEchoLine(entry) {
    const days = Math.max(1, Math.round((Date.now() - entry.at) / DAY));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "echo", text: entry.text || "", echo: entry.echo || "",
          emotion: entry.emotion || "", intensity: entry.intensity || null, days,
        }),
      });
      if (!res.ok) throw new Error("bad");
      const d = await res.json();
      return (d && d.line) ? d.line : mockEchoLine(days);
    } catch { return mockEchoLine(days); }
  }

  function elapsedText(at) {
    const days = Math.max(1, Math.round((Date.now() - at) / DAY));
    if (days >= 365) return `${Math.floor(days / 365)} 年前`;
    if (days >= 30) return `${Math.round(days / 30)} 个月前`;
    return `${days} 天前`;
  }

  function renderEchoThread(entry) {
    const box = $("ebThread");
    const resp = entry.responses || [];
    if (!resp.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = '<div class="eb-thread-title">你曾回应过它</div>' +
      resp.map((r) => `<div class="eb-thread-line"><span>${fmtDate(r.at)}</span>${escapeHtml(r.text)}</div>`).join("");
  }

  async function openEcho(entry, from) {
    echoContext = { id: entry.id, from };
    if (from === "enter") markEchoShownToday();

    $("ebWhen").textContent = `${elapsedText(entry.at)} · ${fmtDate(entry.at)}`;
    $("ebOrigin").textContent = entry.text ? `“${entry.text}”` : "";
    $("ebCaught").textContent = entry.echo ? `那天我接住你:${entry.echo}` : "";
    $("ebReply").value = "";
    $("ebLine").textContent = "……";
    $("ebCrisis").hidden = (Number(entry.intensity) || 0) < 5;  // 高强度旧情绪才轻轻附上热线
    renderEchoThread(entry);

    setView("echo");
    window.scrollTo(0, 0);
    const line = await fetchEchoLine(entry);
    if (echoContext && echoContext.id === entry.id) $("ebLine").textContent = line;  // 若已离开则不覆盖
  }

  function closeEcho(saveReply) {
    const map = loadMap();
    const idx = map.findIndex((e) => e.id === (echoContext && echoContext.id));
    if (idx >= 0) {
      map[idx].echoedAt = Date.now();  // 记录已回响,顺延不再马上打扰
      const reply = $("ebReply").value.trim();
      if (saveReply && reply) {
        map[idx].responses = map[idx].responses || [];
        map[idx].responses.push({ at: Date.now(), text: reply.slice(0, 200) });
      }
      saveMap(map);
    }
    const from = echoContext && echoContext.from;
    echoContext = null;
    if (from === "map") { renderMap(); setView("map"); window.scrollTo(0, 0); }
    else { setView("input"); setTimeout(() => $("feelingText").focus(), 300); maybePromptTask(); }
  }

  $("ebKeepBtn").addEventListener("click", () => closeEcho(true));
  $("ebSkipBtn").addEventListener("click", () => closeEcho(false));

  /* =======================================================
     一件小事 · 收下 → 过些时候温柔回访「做了吗?没做也没关系」
     ======================================================= */
  function loadTasks() {
    try { return JSON.parse(localStorage.getItem(TASK_KEY)) || []; }
    catch { return []; }
  }
  function saveTasks(list) {
    localStorage.setItem(TASK_KEY, JSON.stringify(list.slice(0, 200)));
  }

  let stepTaken = false;  // 当前结果里的小事是否已收下

  function takeTask() {
    if (stepTaken || !lastResult) return;
    const step = (lastResult.d.drawers || {}).step;
    if (!step || !step.action) return;
    const list = loadTasks();
    list.unshift({
      id: Date.now(),
      at: Date.now(),
      action: step.action,
      permission: step.permission || "",
      emotion: lastResult.d.emotion || "",
      weather: lastResult.d.weather || "",
      status: "pending",
      snoozedAt: null,
    });
    saveTasks(list);
    stepTaken = true;
    const btn = $("stepTakeBtn");
    btn.textContent = "记下了 · 什么时候都行";
    btn.classList.add("taken");
    btn.disabled = true;
  }

  // 挑一条该回访的小事:pending、收下满 3 小时、最近没被"还没"顺延过。取最近一条。
  function pickTaskToRecall() {
    const now = Date.now();
    return loadTasks().find((t) =>
      t && t.status === "pending" &&
      now - t.at >= TASK_FOLLOWUP_AGE &&
      (!t.snoozedAt || now - t.snoozedAt >= TASK_SNOOZE)
    ) || null;
  }

  let recallTaskId = null;
  function maybePromptTask() {
    const t = pickTaskToRecall();
    const box = $("taskRecall");
    if (!t) { box.hidden = true; recallTaskId = null; return; }
    recallTaskId = t.id;
    $("taskRecallText").textContent = `你收下过一件小事——「${t.action}」。做了吗?`;
    box.classList.remove("done");
    box.hidden = false;
  }

  function updateTask(id, patch) {
    const list = loadTasks();
    const i = list.findIndex((t) => t.id === id);
    if (i >= 0) { Object.assign(list[i], patch); saveTasks(list); }
  }

  $("stepTakeBtn").addEventListener("click", takeTask);
  $("taskDoneBtn").addEventListener("click", () => {
    if (recallTaskId == null) return;
    updateTask(recallTaskId, { status: "done", doneAt: Date.now() });
    $("taskRecallText").textContent = "那就够了。你为自己做了一件事。";
    $("taskRecall").classList.add("done");
    recallTaskId = null;
    setTimeout(() => {
      if (document.body.getAttribute("data-view") === "input") $("taskRecall").hidden = true;
    }, 1800);
  });
  $("taskSnoozeBtn").addEventListener("click", () => {
    if (recallTaskId == null) return;
    updateTask(recallTaskId, { snoozedAt: Date.now() });
    recallTaskId = null;
    $("taskRecall").hidden = true;
  });
  $("taskDropBtn").addEventListener("click", () => {
    if (recallTaskId == null) return;
    updateTask(recallTaskId, { status: "dropped" });
    recallTaskId = null;
    $("taskRecall").hidden = true;
  });

  /* =======================================================
     隐私护栏 · 给情绪地图上一把锁 + 一键彻底清空
     说明:这是"防随手翻看"的轻量锁,不是强加密(localStorage 本可被开发者工具查看)。
     ======================================================= */
  let mapUnlocked = false;  // 本次会话内解锁一次即可,刷新后重新上锁

  function getLockHash() {
    try { return (JSON.parse(localStorage.getItem(LOCK_KEY)) || {}).hash || ""; }
    catch { return ""; }
  }
  function hasLock() { return !!getLockHash(); }

  async function hashPin(pin) {
    const s = "zala:" + pin;
    try {
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch { /* 落到兜底 */ }
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return "djb2:" + h.toString(16);
  }

  function openMap() {
    renderMap();
    renderPrivacyPanel();
    setView("map");
    window.scrollTo(0, 0);
  }
  function goMap() {
    if (hasLock() && !mapUnlocked) showLock();
    else openMap();
  }

  function showLock() {
    $("lockInput").value = "";
    $("lockSub").textContent = "输入你的密码";
    $("lockSub").classList.remove("err");
    setView("lock");
    window.scrollTo(0, 0);
    setTimeout(() => $("lockInput").focus(), 300);
  }
  async function tryUnlock() {
    const pin = ($("lockInput").value || "").replace(/\D/g, "");
    if (pin.length < 4) return;
    const h = await hashPin(pin);
    if (h === getLockHash()) { mapUnlocked = true; openMap(); }
    else {
      $("lockSub").textContent = "不对，再试试";
      $("lockSub").classList.add("err");
      $("lockInput").value = "";
      $("lockInput").focus();
    }
  }
  $("lockInput").addEventListener("input", () => {
    $("lockInput").value = $("lockInput").value.replace(/\D/g, "").slice(0, 4);
    if ($("lockInput").value.length >= 4) tryUnlock();
  });
  $("lockEnterBtn").addEventListener("click", tryUnlock);
  $("lockBackBtn").addEventListener("click", resetToHome);

  // 地图里的「隐私与安全」面板
  $("privToggle").addEventListener("click", () => {
    $("privBody").hidden = !$("privBody").hidden;
  });

  function renderPrivacyPanel() {
    const row = $("lockRow");
    row.innerHTML = "";
    if (hasLock()) {
      const s = document.createElement("span");
      s.className = "priv-status"; s.textContent = "✦ 这里已上锁";
      const b = document.createElement("button");
      b.className = "ghost"; b.textContent = "取消密码";
      b.addEventListener("click", () => {
        localStorage.removeItem(LOCK_KEY); mapUnlocked = false; renderPrivacyPanel();
      });
      row.append(s, b);
    } else {
      const b = document.createElement("button");
      b.className = "ghost"; b.textContent = "给这里上一把锁";
      b.addEventListener("click", showSetPin);
      row.appendChild(b);
    }
  }

  function showSetPin() {
    const row = $("lockRow");
    row.innerHTML = "";
    const inp = document.createElement("input");
    inp.className = "pin-set-input"; inp.type = "password"; inp.inputMode = "numeric";
    inp.maxLength = 4; inp.placeholder = "设 4 位数字密码"; inp.autocomplete = "off";
    inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(0, 4); });
    const b = document.createElement("button");
    b.className = "ghost"; b.textContent = "设定";
    b.addEventListener("click", async () => {
      const v = (inp.value || "").replace(/\D/g, "").slice(0, 4);
      if (v.length < 4) { inp.focus(); return; }
      const h = await hashPin(v);
      localStorage.setItem(LOCK_KEY, JSON.stringify({ hash: h }));
      mapUnlocked = true; renderPrivacyPanel();
    });
    row.append(inp, b);
    setTimeout(() => inp.focus(), 30);
  }

  // 一键彻底清空:二次点击确认,不用系统弹窗
  $("clearAllBtn").addEventListener("click", () => {
    const btn = $("clearAllBtn");
    if (!btn.classList.contains("confirm")) {
      btn.classList.add("confirm");
      btn.textContent = "确定清空？不可恢复 · 再点一次";
      setTimeout(() => { btn.classList.remove("confirm"); btn.textContent = "清空所有记录"; }, 4000);
      return;
    }
    localStorage.removeItem(MAP_KEY);
    localStorage.removeItem(TASK_KEY);
    localStorage.removeItem(ECHO_KEY);
    btn.classList.remove("confirm"); btn.textContent = "清空所有记录";
    renderMap();
  });

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
