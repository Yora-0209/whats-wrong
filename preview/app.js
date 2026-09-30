const $ = (id) => document.getElementById(id);
let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDay = null, viewedEntry = null, progressTimer = null;
function dateKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function openCard(entry) {
  viewedEntry = entry;
  $('memory-date').textContent = new Date(entry.createdAt).toLocaleString('zh-CN');
  $('memory-title').textContent = entry.title || '那一天的心情';
  $('memory-text').textContent = entry.text;
  $('memory-image').hidden = !entry.art;
  if (entry.art) $('memory-image').src = entry.art.image;
  else $('memory-image').removeAttribute('src');
  $('memory-card').showModal();
}
function renderCalendar() {
  $('month-label').textContent = `${month.getFullYear()}年 ${month.getMonth()+1}月`;
  const grid = $('calendar-days'); grid.replaceChildren();
  const offset = (month.getDay()+6)%7;
  for (let i=0;i<offset;i++) grid.append(document.createElement('span'));
  const counts = new Map();
  for (const entry of entries) { const key=dateKey(entry.createdAt); counts.set(key,(counts.get(key)||0)+1); }
  const days = new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  for (let day=1;day<=days;day++) {
    const key=dateKey(new Date(month.getFullYear(),month.getMonth(),day));
    const count=counts.get(key)||0;
    const button=document.createElement('button'); button.textContent=day;
    button.className=count?'has-entry':'';
    button.setAttribute('aria-label',`${key}，${count}条记录`);
    button.setAttribute('aria-pressed',String(selectedDay===key));
    button.onclick=()=>{selectedDay=key;renderList();}; grid.append(button);
  }
  $('day-label').textContent=selectedDay?`${selectedDay} · ${counts.get(selectedDay)||0}条记录`:'有圆点的日子，留着你的心情。';
}
$('month-prev').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);renderCalendar();};
$('month-next').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar();};
$('all-days').onclick=()=>{selectedDay=null;renderList();};
$('memory-close').onclick=()=>$('memory-card').close();
$('memory-edit').onclick=()=>{if(canLeave()){ $('memory-card').close();show(viewedEntry);$('form').scrollIntoView({block:'start'});}};
let db,
  entries = [],
  current = null,
  dirty = false,
  controller = null,
  requestVersion = 0,
  editRevision = 0;
const status = (message, error = false) => {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
};
const artStatus = (message, error = false) => {
  $("art-status").textContent = message;
  $("art-status").classList.toggle("error", error);
};
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("zala-paper-preview-v1", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("entries", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function storage(mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("entries", mode);
    const result = operation(tx.objectStore("entries"));
    tx.oncomplete = () => resolve(result.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function fresh() {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    title: "",
    text: "",
    scene: "",
    revisit: "",
    art: null,
  };
}
function cancel() {
  clearInterval(progressTimer);
  $('art-progress').hidden = true;
  requestVersion++;
  controller?.abort();
  controller = null;
  $("suggest").disabled = false;
  $("generate").disabled = false;
  $("cancel-art").hidden = true;
}
function canLeave() {
  return !dirty || confirm("这一页还有未保存的修改。放弃修改并离开吗？");
}
function show(entry) {
  editRevision++;
  cancel();
  current = structuredClone(entry);
  dirty = false;
  $("title").value = entry.title;
  $("text").value = entry.text;
  $("scene").value = entry.scene || "";
  $("revisit").value = entry.revisit || "";
  $("date").textContent = new Date(entry.createdAt).toLocaleDateString("zh-CN");
  $("badge").textContent = entry.demo
    ? "示例记录"
    : entries.some((e) => e.id === entry.id)
      ? "已保存"
      : "新的一页";
  $("delete").hidden = !entries.some((e) => e.id === entry.id);
  $("art-panel").hidden = true;
  $("basis").textContent = "";
  renderArt();
  renderHistory();
  renderList();
  artStatus("");
  status("");
}
function renderHistory() {
  const list = $("saved-messages");
  list.replaceChildren();
  const history = Array.isArray(current.conversation)
    ? current.conversation
    : [];
  $("saved-conversation").hidden = !history.length;
  for (const m of history) {
    if (!m || typeof m.content !== "string") continue;
    const p = document.createElement("p");
    const label = document.createElement("strong");
    label.textContent = m.role === "assistant" ? "咋啦回应：" : "你写下的：";
    p.append(label, document.createTextNode(m.content));
    list.append(p);
  }
}
function renderArt() {
  $("artwork").hidden = !current.art;
  if (current.art) {
    $("art-image").src = current.art.image;
    $("art-caption").textContent = current.art.demo
      ? "固定示例插画 · 不是实时生成"
      : current.art.scene || "这条记录的小画";
  }
}
function renderList() {
  renderCalendar();
  const box = $("entries");
  box.replaceChildren();
  if (!entries.length) {
    const p = document.createElement("p");
    p.textContent = "还没有记录。可以从今天开始。";
    box.append(p);
  }
  for (const entry of [...entries].sort((a, b) => b.createdAt - a.createdAt)) {
    if (selectedDay && dateKey(entry.createdAt) !== selectedDay) continue;
    const button = document.createElement("button");
    button.className = "entry";
    button.setAttribute("aria-current", String(entry.id === current?.id));
    const title = document.createElement("strong");
    title.textContent =
      entry.title || entry.text.slice(0, 14) || "没有标题的一天";
    const date = document.createElement("span");
    date.textContent =
      new Date(entry.createdAt).toLocaleDateString("zh-CN") +
      (entry.demo ? " · 示例" : "");
    button.append(title, date);
    if(entry.art){const image=document.createElement('img');image.src=entry.art.image;image.alt='这一天的小画';image.loading='lazy';button.prepend(image);}
    if (entry.revisit) {
      const label = document.createElement("span");
      label.textContent =
        entry.revisit <= localDay()
          ? "可以再看看那一天"
          : `留到 ${entry.revisit}`;
      button.append(label);
    }
    button.onclick = () => {
      openCard(entry);
    };
    box.append(button);
  }
}
function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
async function save() {
  if (!$("text").value.trim()) {
    status("先写下一点内容，再保存。", true);
    $("text").focus();
    return false;
  }
  const revision = editRevision;
  const next = {
    ...current,
    title: $("title").value.trim(),
    text: $("text").value.trim(),
    scene: $("scene").value.trim(),
    revisit: $("revisit").value,
    updatedAt: Date.now(),
  };
  try {
    await storage("readwrite", (store) => store.put(next));
    entries = await storage("readonly", (store) => store.getAll());
    if (current.id === next.id) {
      if (revision === editRevision) {
        current = next;
        dirty = false;
        $("badge").textContent = "已保存";
      }
      $("delete").hidden = false;
      status(
        dirty
          ? "已保存刚才的内容。后续修改还需要保存。"
          : "这一页已保存在当前浏览器。",
      );
    }
    renderList();
    return true;
  } catch {
    status(
      "浏览器未能保存，可能是存储空间不足。文字仍在页面上，请复制备份。",
      true,
    );
    return false;
  }
}
async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  const data = await response
    .json()
    .catch(() => ({ error: "服务暂时不可用；请使用支持 API 的预览服务器。" }));
  if (!response.ok) throw new Error(data.error || "暂时没连上");
  return data;
}
for (const id of ["title", "text", "scene", "revisit"])
  $(id).addEventListener("input", () => {
    dirty = true;
    editRevision++;
    if (id === "text" || id === "scene") {
      cancel();
      $("basis").textContent = "";
    }
  });
$("form").onsubmit = (event) => {
  event.preventDefault();
  save();
};
$("save-all").onclick = save;
$("new").onclick = () => {
  if (canLeave()) {
    show(fresh());
    $("form").scrollIntoView({ block: "start" });
    $("text").focus();
  }
};
$("home").onclick = (event) => {
  if (!canLeave()) event.preventDefault();
  else {
    dirty = false;
    cancel();
  }
};
$("demo").onclick = () => {
  if (!canLeave()) return;
  show({
    ...fresh(),
    demo: true,
    title: "改了三遍方案",
    text: "今天改了三遍方案，还是觉得不够好。",
    scene: "几张带有修改痕迹的浅绿色草稿纸，旁边放着一支短短的砖红色铅笔。",
    art: { image: "./assets/notebook.png", demo: true },
  });
  status("这是固定示例。点击保存后才会进入你的日记。");
  $("form").scrollIntoView({ block: "start" });
};
$("art-toggle").onclick = () => {
  $("art-panel").hidden = !$("art-panel").hidden;
  if (!$("art-panel").hidden) $("scene").focus();
};
$("cancel-art").onclick = () => {
  cancel();
  artStatus("已停止等待，文字和已有配图没有改变。");
};
$("remove-art").onclick = () => {
  cancel();
  current.art = null;
  dirty = true;
  editRevision++;
  renderArt();
  artStatus("已移除当前配图，保存后生效。");
};
$("suggest").onclick = async () => {
  const source = $("text").value.trim();
  if (!source) {
    artStatus("先写下今天发生的事。", true);
    return;
  }
  cancel();
  const token = requestVersion;
  controller = new AbortController();
  $("suggest").disabled = true;
  $("cancel-art").hidden = false;
  artStatus("正在根据原文整理画面……");
  try {
    const brief = await api("/api/art-brief", { text: source });
    if (token !== requestVersion) return;
    if (typeof brief.scene !== "string" || typeof brief.basis !== "string")
      throw new Error("返回的画面描述不完整");
    $("scene").value = brief.scene;
    $("basis").textContent =
      `依据原文：“${brief.basis}”${brief.abstract ? " · 这是一种抽象表达" : ""}`;
    dirty = true;
    editRevision++;
    artStatus("请检查画面描述。确认后再点击生成小画。");
  } catch (error) {
    if (token === requestVersion) artStatus(error.message, true);
  } finally {
    if (token === requestVersion) cancel();
  }
};
$("generate").onclick = async () => {
  if (!$('text').value.trim()) { artStatus('先写下一点心情，再为它配画。',true); $('text').focus(); return; }
  const scene = $("scene").value.trim();
  if (!scene) {
    artStatus("先描述你希望画下来的物件或形状。", true);
    $("scene").focus();
    return;
  }
  cancel();
  const token = requestVersion;
  controller = new AbortController();
  $("generate").disabled = true;
  $("cancel-art").hidden = false;
  artStatus("正在画下这个画面……");
  $('art-progress').hidden=false;
  const started=Date.now();
  const tick=()=>{$('art-elapsed').textContent=`已等待 ${Math.floor((Date.now()-started)/1000)} 秒 · 小画完成后会自动保存`;};
  tick(); progressTimer=setInterval(tick,1000);
  try {
    const art = await api("/api/diary-art", { scene });
    if (token !== requestVersion) return;
    if (
      typeof art.image !== "string" ||
      !/^data:image\/(png|jpeg);base64,/.test(art.image)
    )
      throw new Error("收到的图片格式不正确");
    current.art = {
      image: art.image,
      scene,
      styleVersion: art.styleVersion,
      createdAt: Date.now(),
    };
    dirty = true;
    editRevision++;
  renderArt();
    const saved = await save();
    if(token===requestVersion) artStatus(saved ? '小画和文字已一起保存在这一天。可以在日历里回看。' : '小画已画好，但还没有保存成功。请保留页面并再次保存。', !saved);
  } catch (error) {
    if (token === requestVersion) artStatus(error.message, true);
  } finally {
    if (token === requestVersion) cancel();
  }
};
$("delete").onclick = async () => {
  if (!confirm("删除这条记录和它的小画？此操作无法撤销。")) return;
  cancel();
  try {
    await storage("readwrite", (store) => store.delete(current.id));
    entries = await storage("readonly", (store) => store.getAll());
    show(fresh());
    status("这条记录已删除。");
  } catch {
    status("删除失败，记录没有被确认移除。", true);
  }
};
$("export").onclick = () => {
  const content = JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), entries },
    null,
    2,
  );
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `情绪日记-${localDay()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("已导出已保存的记录，文件含私人文字与配图，请妥善保存。");
};
$("import").onclick = async () => {
  try {
    if (localStorage.getItem("zala_lock_v1")) {
      status(
        "原版设置了访问锁。请先在原版处理访问权限，本预览不会绕过锁读取记录。",
        true,
      );
      return;
    }
    const old = JSON.parse(localStorage.getItem("zala_map_v1") || "[]");
    if (!Array.isArray(old)) throw new Error("invalid");
    const eligible = old.filter(
      (e) => e && typeof e.text === "string" && e.text.trim(),
    );
    if (!eligible.length) {
      status("这个浏览器中没有可复制的原版记录。");
      return;
    }
    if (!confirm(`复制 ${eligible.length} 条原版记录？原版记录保持不变。`))
      return;
    entries = await storage("readonly", (store) => store.getAll());
    const known = new Set(entries.map((e) => e.legacyId));
    let count = 0;
    for (const [i, e] of eligible.entries()) {
      const legacyId = String(e.id ?? `${e.at ?? e.ts ?? "entry"}-${i}`);
      if (known.has(legacyId)) continue;
      const at = Number(e.at ?? e.ts);
      await storage("readwrite", (store) =>
        store.put({
          ...fresh(),
          legacyId,
          text: e.text,
          title: e.text.slice(0, 14),
          createdAt: Number.isFinite(at) && at > 0 ? at : Date.now(),
        }),
      );
      count++;
    }
    entries = await storage("readonly", (store) => store.getAll());
    renderList();
    status(`已复制 ${count} 条文字记录。原版数据未修改。`);
  } catch {
    status("复制未完成。已复制的条目会保留，可重试；原版数据未修改。", true);
  }
};
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
try {
  db = await openDB();
  entries = await storage("readonly", (store) => store.getAll());
  const wanted = new URLSearchParams(location.search).get("entry");
  show(entries.find((e) => e.id === wanted) || fresh());
} catch {
  current = fresh();
  for (const id of [
    "new",
    "demo",
    "suggest",
    "generate",
    "export",
    "import",
    "save-all",
  ])
    $(id).disabled = true;
  status("当前浏览器无法打开本地存储，请允许网站存储后重试。", true);
}
