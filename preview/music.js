const audio = new Audio('../assets/audio/ambient.mp3');
audio.loop = true;
audio.volume = 0.18;
audio.preload = 'none';
let enabled = false;
try { enabled = localStorage.getItem('zala-paper-music') === 'on'; } catch {}
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
  if (!enabled || document.hidden || document.body.dataset.screen === 'listen') return;
  try { await audio.play(); if (!enabled || document.hidden || document.body.dataset.screen === 'listen') audio.pause(); }
  catch { enabled=false;remember();label();button.textContent = '♪ 点此重试'; }
}
button.onclick = async () => {
  enabled = !enabled;
  label();
  if (enabled) await play(); else audio.pause();
  remember();
};
document.addEventListener('pointerdown', (event) => {
  if (event.target !== button) play();
}, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.pause(); else play();
});
new MutationObserver(() => {
  if (document.body.dataset.screen === 'listen') audio.pause(); else play();
}).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
label();
