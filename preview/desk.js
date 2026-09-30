import { saveEntry } from "./storage.js";
const $ = (id) => document.getElementById(id);
let screen = "home",
  messages = [],
  request = null,
  version = 0,
  failed = false,
  crisis = false,
  sessionId = crypto.randomUUID(),
  sessionAt = Date.now(),
  saved = false,
  suggestions = null,
  audioReturn = "home";
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null,
  listening = false,
  speechBase = "",
  gotSpeech = false;
const audio = new Audio();
audio.loop = true;
audio.preload = "none";
audio.volume = 0.35;
let sound = "rain",
  playing = false,
  audioVersion = 0;
function announce(message) {
  $("chat-status").textContent = message;
}
function hasWriting() {
  return (
    messages.some((m) => m.role === "user") ||
    $("feeling").value.trim().length > 0
  );
}
function stopRequest() {
  version++;
  request?.abort();
  request = null;
  $("waiting").hidden = true;
  $("send").disabled = false;
}
function updateComposerCount() {
  $("count").textContent = `${$("feeling").value.length} / 2000`;
}
function stopListening() {
  if (listening) recognition?.stop();
}
function showScreen(next) {
  if (screen === "listen" && next !== "listen") stopAudio();
  if (screen === "write" && next !== "write") stopListening();
  screen = next;
  document.body.dataset.screen = next;
  for (const name of ["home", "write", "listen"])
    $(name + "-screen").hidden = name !== next;
  $("back").hidden = next === "home";
  window.scrollTo({ top: 0, behavior: "instant" });
  if (next !== "home")
    $(next === "write" ? "write-title" : "listen-title").focus({
      preventScroll: true,
    });
}
function renderMessages() {
  $("conversation").replaceChildren();
  for (const m of messages) {
    const node = document.createElement("p");
    node.className = "utterance" + (m.role === "assistant" ? " ai" : "");
    const label = document.createElement("span");
    label.textContent = m.role === "user" ? "你写下的" : "咋啦回应";
    node.append(label, document.createTextNode(m.content));
    $("conversation").append(node);
  }
  $("support").hidden = !crisis;
  $("reply-actions").hidden = crisis || messages.at(-1)?.role !== "assistant";
  $("error-actions").hidden = !failed;
}
function searchLink(query, type = 1) {
  return `https://music.163.com/#/search/m/?s=${encodeURIComponent(query)}&type=${type}`;
}
function sticker(title, kicker, fill) {
  const card = document.createElement("article");
  card.className = "sticker";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sticker-toggle";
  button.setAttribute("aria-expanded", "false");
  const small = document.createElement("small");
  small.textContent = kicker;
  const strong = document.createElement("strong");
  strong.textContent = title;
  button.append(small, strong);
  const detail = document.createElement("div");
  detail.className = "sticker-detail";
  detail.hidden = true;
  fill(detail);
  button.onclick = () => {
    const open = detail.hidden;
    detail.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  card.append(button, detail);
  return card;
}
function renderSuggestions(value) {
  const valid =
    value &&
    typeof value.music?.title === "string" &&
    typeof value.music?.query === "string" &&
    Array.isArray(value.music?.songs) &&
    value.music.songs.every(
      (song) =>
        Array.isArray(song) &&
        song.length === 2 &&
        song.every((part) => typeof part === "string"),
    ) &&
    typeof value.movie?.title === "string" &&
    typeof value.movie?.note === "string" &&
    typeof value.action?.title === "string" &&
    typeof value.action?.detail === "string";
  suggestions = valid ? value : null;
  const section = $("suggestion-stickers");
  const grid = $("sticker-grid");
  grid.replaceChildren();
  section.hidden = !suggestions || crisis;
  if (section.hidden) return;
  const music = suggestions.music;
  grid.append(
    sticker(music.title, "听三首歌", (detail) => {
      for (const [title, artist] of music.songs) {
        const link = document.createElement("a");
        link.href = searchLink(`${title} ${artist}`);
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = `${title} · ${artist}`;
        detail.append(link);
      }
      const more = document.createElement("a");
      more.href = searchLink(music.query, 1000);
      more.target = "_blank";
      more.rel = "noopener";
      more.textContent = "在网易云找相似歌单 ↗";
      detail.append(more);
    }),
  );
  const movie = suggestions.movie;
  grid.append(
    sticker(movie.title, "看一部电影", (detail) => {
      const note = document.createElement("p");
      note.textContent = movie.note;
      const link = document.createElement("a");
      link.href = `https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(movie.title)}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "看看电影介绍 ↗";
      detail.append(note, link);
    }),
  );
  const action = suggestions.action;
  grid.append(
    sticker(action.title, "现在做件小事", (detail) => {
      const p = document.createElement("p");
      p.textContent = action.detail;
      detail.append(p);
    }),
  );
}
function showComposer() {
  renderSuggestions(null);
  $("write-form").hidden = false;
  $("reply-actions").hidden = true;
  $("feeling").focus();
}
function reset() {
  stopListening();
  stopRequest();
  messages = [];
  failed = false;
  crisis = false;
  saved = false;
  suggestions = null;
  sessionId = crypto.randomUUID();
  sessionAt = Date.now();
  $("feeling").value = "";
  updateComposerCount();
  $("send").textContent = "说好了 ↗";
  $("write-form").hidden = false;
  renderMessages();
  renderSuggestions(null);
  announce("");
}
function recentContext(history) {
  const result = [];
  let size = 0;
  for (const item of history.slice(-12).reverse()) {
    if (size + item.content.length > 12000) break;
    result.unshift(item);
    size += item.content.length;
  }
  return result;
}
async function requestReply() {
  if (request || messages.at(-1)?.role !== "user") return;
  failed = false;
  renderMessages();
  $("write-form").hidden = true;
  $("waiting").hidden = false;
  announce("");
  const token = ++version;
  request = new AbortController();
  const timeout = setTimeout(() => request?.abort(), 35000);
  try {
    const response = await fetch("/api/paper-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: recentContext(messages) }),
      signal: request.signal,
    });
    const data = await response
      .json()
      .catch(() => ({ error: "回应服务暂时没有连接，文字还在。" }));
    if (token !== version) return;
    if (!response.ok) throw new Error(data.error || "暂时没连上，文字还在。");
    if (
      !["ok", "crisis"].includes(data.safety) ||
      typeof data.echo !== "string" ||
      !data.echo.trim() ||
      data.echo.length > 500
    )
      throw new Error("这次回应不完整，文字还在。");
    messages.push({ role: "assistant", content: data.echo });
    crisis = crisis || data.safety === "crisis";
    saved = false;
    renderMessages();
    renderSuggestions(data.suggestions);
    if (crisis) {
      $("write-form").hidden = false;
      $("send").textContent = "继续说";
    } else $("continue").focus();
  } catch (error) {
    if (token !== version) return;
    failed = true;
    renderMessages();
    announce(
      error.name === "AbortError"
        ? "等候超时，文字还在。可以重新试试。"
        : error.message,
    );
  } finally {
    clearTimeout(timeout);
    if (token === version) {
      request = null;
      $("waiting").hidden = true;
      $("send").disabled = false;
    }
  }
}
$("write").onclick = () => {
  showScreen("write");
  if (!$("write-form").hidden) $("feeling").focus();
};
$("feeling").oninput = () => {
  saved = false;
  updateComposerCount();
};
if (!SpeechRecognition) {
  $("voice").disabled = true;
  $("voice").textContent = "此浏览器暂不支持听写";
} else {
  recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onstart = () => {
    listening = true;
    $("voice").disabled = false;
    $("voice").textContent = "停止听写";
    $("voice").setAttribute("aria-pressed", "true");
    $("speech-status").textContent = "正在听，你可以慢慢说……";
  };
  recognition.onresult = (event) => {
    gotSpeech = true;
    let transcript = "";
    for (let i = 0; i < event.results.length; i++)
      transcript += event.results[i][0].transcript;
    $("feeling").value = `${speechBase}${speechBase && transcript ? "\n" : ""}${transcript}`.slice(
      0,
      2000,
    );
    saved = false;
    updateComposerCount();
  };
  recognition.onerror = (event) => {
    const messages = {
      "not-allowed": "麦克风被拦截了。请在地址栏的网站设置中允许麦克风，再刷新页面。",
      "service-not-allowed":
        "麦克风被拦截了。请在地址栏的网站设置中允许麦克风，再刷新页面。",
      "no-speech": "刚才没有听清，可以再试一次。",
      "audio-capture": "没有找到可用的麦克风，请检查设备后再试。",
      network:
        "当前浏览器暂时连不上听写服务。可以换用 Chrome，或使用系统键盘上的麦克风。",
      aborted: "听写已停止，已经写下的内容还在。",
    };
    $("speech-status").textContent =
      messages[event.error] || "听写暂时没有成功，可以继续打字。";
  };
  recognition.onend = () => {
    listening = false;
    $("voice").disabled = false;
    $("voice").textContent = "说给纸听";
    $("voice").setAttribute("aria-pressed", "false");
    if ($("speech-status").textContent.startsWith("正在听"))
      $("speech-status").textContent = gotSpeech
        ? "已经写在纸上了，你可以继续修改。"
        : "没有听到内容，可以再试一次。";
  };
  $("voice").onclick = async () => {
    if (listening) {
      recognition.stop();
      return;
    }
    $("speech-status").textContent = "";
    $("voice").disabled = true;
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        $("speech-status").textContent = "正在请求麦克风权限……";
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        $("speech-status").textContent =
          "没有获得麦克风权限。请在地址栏的网站设置中允许麦克风，再刷新页面。";
        $("voice").disabled = false;
        return;
      }
    }
    speechBase = $("feeling").value.trim();
    gotSpeech = false;
    try {
      recognition.start();
    } catch {
      $("speech-status").textContent = "听写正在准备，请稍后再试。";
      $("voice").disabled = false;
    }
  };
}
$("write-form").onsubmit = (event) => {
  event.preventDefault();
  stopListening();
  if (request) return;
  const text = $("feeling").value.trim();
  if (!text) {
    announce("可以先写下几个字。");
    $("feeling").focus();
    return;
  }
  messages.push({ role: "user", content: text });
  $("feeling").value = "";
  updateComposerCount();
  saved = false;
  renderMessages();
  requestReply();
};
$("continue").onclick = showComposer;
$("write-more").onclick = () => {
  failed = false;
  renderMessages();
  showComposer();
};
$("retry").onclick = requestReply;
$("cancel-chat").onclick = () => {
  stopRequest();
  failed = true;
  renderMessages();
  announce("已停止等待，文字还在。");
};
function finish() {
  stopListening();
  if (!hasWriting()) {
    reset();
    showScreen("home");
    return;
  }
  stopRequest();
  if (messages.at(-1)?.role === "user") {
    failed = true;
    renderMessages();
  }
  $("save-status").textContent = "";
  $("finish-dialog").showModal();
}
$("finish").onclick = finish;
$("back").onclick = () => {
  if (screen === "listen") showScreen(audioReturn);
  else finish();
};
$("discard-conversation").onclick = () => {
  $("finish-dialog").close();
  reset();
  showScreen("home");
  $("write").focus();
};
$("save-conversation").onclick = async () => {
  const pending = $("feeling").value.trim();
  const transcript = [
    ...messages,
    ...(pending ? [{ role: "user", content: pending }] : []),
  ];
  const userText = transcript
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");
  if (!userText) {
    $("save-status").textContent = "还没有需要保存的文字。";
    return;
  }
  $("save-conversation").disabled = true;
  try {
    await saveEntry({
      id: sessionId,
      createdAt: sessionAt,
      title: transcript.find((m) => m.role === "user").content.slice(0, 18),
      text: userText,
      conversation: transcript,
      scene: "",
      revisit: "",
      art: null,
    });
    saved = true;
    location.href = `./journal.html?entry=${encodeURIComponent(sessionId)}`;
  } catch {
    $("save-status").textContent =
      "浏览器未能保存。文字仍在，请先复制备份后再试。";
  } finally {
    $("save-conversation").disabled = false;
  }
};
function openListen(from) {
  audioReturn = from;
  $("return-paper").textContent = from === "write" ? "回到纸上" : "回到桌前";
  showScreen("listen");
}
$("listen").onclick = () => openListen("home");
$("activity").onclick = () => openListen("write");
$("return-paper").onclick = () => showScreen(audioReturn);
function audioLabel() {
  $("play-audio").textContent = playing
    ? "暂停"
    : `播放${sound === "rain" ? "雨声" : "海潮"}`;
}
function stopAudio() {
  audioVersion++;
  audio.pause();
  playing = false;
  audioLabel();
}
$("play-audio").onclick = async () => {
  if (playing) {
    stopAudio();
    return;
  }
  const token = ++audioVersion;
  $("audio-status").textContent = "";
  audio.src = `../assets/audio/${sound}.mp3`;
  audio.volume = Number($("volume").value);
  try {
    await audio.play();
    if (token !== audioVersion) {
      audio.pause();
      return;
    }
    playing = true;
    audioLabel();
  } catch {
    if (token === audioVersion)
      $("audio-status").textContent = "声音暂时没有播放成功，可以再试一次。";
  }
};
for (const radio of document.querySelectorAll("[name=sound]"))
  radio.onchange = () => {
    stopAudio();
    sound = radio.value;
    $("audio-status").textContent = "";
    audioLabel();
  };
$("volume").oninput = () => (audio.volume = Number($("volume").value));
audio.onerror = () => {
  stopAudio();
  $("audio-status").textContent = "声音文件暂时无法播放。";
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopAudio();
});
window.addEventListener("beforeunload", (event) => {
  if (hasWriting() && !saved) {
    event.preventDefault();
    event.returnValue = "";
  }
});
for (const link of document.querySelectorAll('a[href="./journal.html"]'))
  link.addEventListener("click", (event) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    if (hasWriting() && !saved) return; // Native navigation preserves the unsaved-changes prompt.
    event.preventDefault();
    document.body.classList.add("leaving");
    setTimeout(
      () => {
        location.href = link.href;
      },
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240,
    );
  });
window.addEventListener("pageshow", () =>
  document.body.classList.remove("leaving"),
);
