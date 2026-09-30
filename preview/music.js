const audio = new Audio('../assets/audio/ambient.mp3');
audio.loop = true;
audio.volume = 0;
audio.preload = 'none';
let enabled = true, fade = null, pending = false;
try { enabled = localStorage.getItem('zala-paper-music') !== 'off'; } catch {}
const button = document.createElement('button');
button.className = 'music-switch';
button.type = 'button';
document.body.append(button);
function label() {
  button.textContent = enabled ? '♫ 音乐开' : '♪ 音乐关';
  button.setAttribute('aria-pressed', String(enabled));
  button.setAttribute('aria-label', enabled ? '关闭背景音乐' : '打开背景音乐');
}
function remember() {
  try { localStorage.setItem('zala-paper-music', enabled ? 'on' : 'off'); } catch {}
}
async function play() {
  if (!enabled || pending || !audio.paused || document.hidden || document.body.dataset.screen === 'listen') return;
  pending = true; audio.volume = 0;
  try {
    await audio.play();
    if (!enabled || document.hidden || document.body.dataset.screen === 'listen') { pause(); return; }
    label();
    const started = performance.now();
    clearInterval(fade);
    fade = setInterval(() => {
      const t = Math.min(1, (performance.now()-started)/5000);
      audio.volume = 0.16 * t*t*(3-2*t);
      if (t === 1) clearInterval(fade);
    }, 50);
  } catch { if (enabled) button.textContent = '♪ 轻触开启'; }
  finally { pending = false; }
}
function pause() { clearInterval(fade); audio.pause(); audio.volume = 0; }
button.onclick = async () => {
  if (enabled && audio.paused && document.body.dataset.screen !== 'listen') { await play(); return; }
  enabled = !enabled;
  label();
  if (enabled) await play(); else pause();
  remember();
};
document.addEventListener('pointerdown', (event) => {
  if (event.target !== button) play();
});
document.addEventListener('keydown', (event) => { if(event.target !== button) play(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause(); else play();
});
new MutationObserver(() => {
  if (document.body.dataset.screen === 'listen') pause(); else play();
}).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
label(); play();
