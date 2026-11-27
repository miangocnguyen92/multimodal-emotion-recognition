/* Mood Diary – frontend logic */
const $ = (id) => document.getElementById(id);
const EMOTIONS = ["happy", "sad", "angry", "disgusted", "fearful", "neutral", "surprised"];
const COLORS = { happy: "#E8A33D", sad: "#4C7BD9", angry: "#D9534F", disgusted: "#6E9E3A",
                 fearful: "#8E6CCF", neutral: "#9AA0A6", surprised: "#E07BA6" };
const VOICE_WEIGHT = 0.6;     // speaking mode: 60% tone of voice, 40% words
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const S = {
  chats: [], chat: null, mode: "writing", muted: false, busy: false, view: "chat",
  setup: { gender: "female", personality: "warm" }, dashDays: 7, charts: {},
};

/* ======================= helpers ======================= */
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Server error " + res.status);
  return res.json();
}

function avatarSVG(gender) {
  if (gender === "male") return `
  <svg viewBox="0 0 200 200" width="100%" height="100%" role="img" aria-label="Male companion">
    <circle cx="100" cy="100" r="100" fill="#ECEFF6"/>
    <path d="M42 210 Q48 160 100 156 Q152 160 158 210 Z" fill="#5B7DB8"/>
    <rect x="88" y="138" width="24" height="22" fill="#E6B999"/>
    <ellipse cx="100" cy="102" rx="44" ry="50" fill="#F0C9AB"/>
    <path d="M56 98 Q50 40 100 38 Q150 40 144 98 Q140 64 112 60 Q96 68 80 62 Q60 66 56 98 Z" fill="#33261E"/>
    <path d="M74 92 L90 90 M110 90 L126 92" stroke="#33261E" stroke-width="3" stroke-linecap="round"/>
    <g class="eyes"><ellipse cx="83" cy="104" rx="4.5" ry="6" fill="#2A2A2A"/><ellipse cx="117" cy="104" rx="4.5" ry="6" fill="#2A2A2A"/></g>
    <ellipse class="mouth" cx="100" cy="130" rx="9" ry="3" fill="#9E4A4F"/>
  </svg>`;
  return `
  <svg viewBox="0 0 200 200" width="100%" height="100%" role="img" aria-label="Female companion">
    <circle cx="100" cy="100" r="100" fill="#E9F1F0"/>
    <path d="M46 112 Q42 36 100 34 Q158 36 154 112 L160 176 Q100 190 40 176 Z" fill="#3E2A2A"/>
    <path d="M44 210 Q50 162 100 158 Q150 162 156 210 Z" fill="#7FB3AE"/>
    <rect x="89" y="140" width="22" height="22" fill="#EDC3AA"/>
    <ellipse cx="100" cy="104" rx="44" ry="50" fill="#F5D3BE"/>
    <path d="M56 96 Q62 48 100 46 Q138 48 144 96 Q126 70 98 66 Q74 72 56 96 Z" fill="#3E2A2A"/>
    <g class="eyes"><ellipse cx="83" cy="106" rx="4.5" ry="6" fill="#2A2A2A"/><ellipse cx="117" cy="106" rx="4.5" ry="6" fill="#2A2A2A"/></g>
    <circle cx="74" cy="122" r="7" fill="#F29BA8" opacity=".4"/><circle cx="126" cy="122" r="7" fill="#F29BA8" opacity=".4"/>
    <ellipse class="mouth" cx="100" cy="132" rx="8" ry="3.5" fill="#C2505F"/>
  </svg>`;
}

function topEmotion(p) { return EMOTIONS.reduce((a, b) => ((p[b] || 0) > (p[a] || 0) ? b : a)); }
function fmtWhen(iso) {
  const d = new Date(iso), today = new Date();
  const days = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 0) return time;
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function groupOf(iso) {
  const d = new Date(iso), today = new Date();
  const days = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  return days === 0 ? "TODAY" : days === 1 ? "YESTERDAY" : days < 7 ? "THIS WEEK" : "EARLIER";
}

/* ======================= views ======================= */
function show(view) {
  S.view = view;
  ["chat", "setup", "dashboard"].forEach((v) => $("view-" + v).hidden = v !== view);
  document.querySelectorAll(".nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view || (view === "setup" && b.dataset.view === "chat")));
  if (view === "dashboard") loadDashboard();
}
document.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => {
  if (b.dataset.view === "chat" && !S.chat) return show("setup");
  show(b.dataset.view);
});

/* ======================= sidebar history ======================= */
async function loadChats() {
  S.chats = await api("/api/chats");
  renderHistory();
}
function renderHistory() {
  const q = $("search").value.trim().toLowerCase();
  const list = S.chats.filter((c) => !q || c.title.toLowerCase().includes(q) || c.agent_name.toLowerCase().includes(q));
  const box = $("history");
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = `<div class="empty">${q ? "No chats match your search." : "No chats yet. Start one!"}</div>`; return; }
  let group = "";
  for (const c of list) {
    const g = groupOf(c.updated_at);
    if (g !== group) { group = g; box.insertAdjacentHTML("beforeend", `<div class="group">${g}</div>`); }
    const btn = document.createElement("button");
    btn.className = S.chat && S.chat.id === c.id ? "active" : "";
    btn.innerHTML = `<span class="dot" style="background:${COLORS[c.top_emotion] || "#D9D3C9"}"></span>
      <span style="min-width:0"><span class="t"></span><span class="s"></span></span>`;
    btn.querySelector(".t").textContent = c.title;
    btn.querySelector(".s").textContent = `with ${c.agent_name} · ${fmtWhen(c.updated_at)}`;
    btn.onclick = () => !S.busy && openChat(c.id);
    box.appendChild(btn);
  }
}
$("search").oninput = renderHistory;
$("newChatBtn").onclick = () => !S.busy && show("setup");

/* ======================= open a chat ======================= */
async function openChat(id) {
  const { chat, messages } = await api(`/api/chats/${id}`);
  S.chat = chat;
  speechSynthesis.cancel();
  $("chatTitle").textContent = chat.title;
  $("chatSub").textContent = `${new Date(chat.created_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · talking with ${chat.agent_name}`;
  $("agentName").textContent = chat.agent_name;
  $("avatar").innerHTML = avatarSVG(chat.gender);
  setStatus(false);
  $("messages").innerHTML = "";
  addDayPill(`Diary entry started ${new Date(chat.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  let lastEmo = null;
  for (const m of messages) {
    if (m.role === "assistant") addBot(m.content);
    else { addUser(m.content, m.source, m.emotions); if (m.emotions) lastEmo = m.emotions; }
  }
  setEmotionPanel(lastEmo);
  renderHistory();
  show("chat");
}

/* ======================= chat bubbles ======================= */
function scrollDown() { $("messages").scrollTop = $("messages").scrollHeight; }
function addDayPill(text) {
  const el = document.createElement("div");
  el.className = "day-pill"; el.textContent = text;
  $("messages").appendChild(el);
}
function addBot(text, cls = "") {
  const el = document.createElement("div");
  el.className = "msg bot " + cls; el.textContent = text;
  $("messages").appendChild(el); scrollDown();
  return el;
}
function addUser(text, source, emotions) {
  const wrap = document.createElement("div");
  wrap.className = "user-wrap";
  const el = document.createElement("div");
  el.className = "msg user"; el.textContent = text;
  const tag = document.createElement("span");
  tag.className = "tag";
  wrap.append(el, tag);
  $("messages").appendChild(wrap); scrollDown();
  const setTag = (src, emo) => {
    if (!emo) { tag.textContent = src === "spoken" ? "spoken" : ""; return; }
    const t = topEmotion(emo);
    tag.textContent = `${src === "spoken" ? "spoken" : "written"} · ${t} ${Math.round(emo[t] * 100)}%`;
  };
  setTag(source, emotions);
  return { wrap, el, setTag };
}

/* ======================= emotion panel ======================= */
function setEmotionPanel(p, spoken) {
  const box = $("emoBars");
  box.innerHTML = "";
  if (!p) { $("emoChip").textContent = "Say something to begin"; $("emoChip").style.cssText = ""; return; }
  const t = topEmotion(p);
  $("emoChip").textContent = `Mostly ${t} · from ${spoken ? "voice + words" : "your words"}`;
  $("emoChip").style.cssText = `background:${COLORS[t]}22;color:#1F2328`;
  [...EMOTIONS].sort((a, b) => (p[b] || 0) - (p[a] || 0)).forEach((e) => {
    const pct = Math.round((p[e] || 0) * 100);
    box.insertAdjacentHTML("beforeend",
      `<span>${cap(e)}</span><span class="track"><span class="fill" style="display:block;width:${pct}%;background:${COLORS[e]}"></span></span><span class="pct">${pct}%</span>`);
  });
}

async function textEmotion(text) {
  try { return (await api("/api/emotion", { method: "POST", body: { text } })).emotions; }
  catch (e) { console.warn("text emotion:", e); return null; }
}
async function voiceEmotion(blob) {
  try {
    const form = new FormData(); form.append("audio", blob, "speech.webm");
    return (await (await fetch("/api/voice-emotion", { method: "POST", body: form })).json()).emotions;
  } catch (e) { console.warn("voice emotion:", e); return null; }
}
function fuse(voice, text) {
  if (voice && text) {
    const out = {};
    EMOTIONS.forEach((e) => out[e] = VOICE_WEIGHT * (voice[e] || 0) + (1 - VOICE_WEIGHT) * (text[e] || 0));
    return out;
  }
  return voice || text;
}

/* ======================= voice (browser speech) ======================= */
function pickVoice(gender) {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const hint = gender === "male" ? /david|guy|mark|daniel|male|ryan|christopher|eric/i : /zira|aria|jenny|samantha|female|ava|emma|michelle/i;
  return voices.find((v) => hint.test(v.name)) || voices[0];
}
function setStatus(speaking) {
  $("avatar").classList.toggle("talking", speaking);
  $("agentStatus").classList.toggle("speaking", speaking);
  $("agentStatus").lastChild.textContent = speaking ? "Speaking" : "Listening";
}
/* speak one sentence; onProgress(n) = first n characters have been said */
function speakSentence(text, gender, onProgress) {
  return new Promise((resolve) => {
    if (S.muted || !text.trim()) { onProgress(text.length); return resolve(); }
    const u = new SpeechSynthesisUtterance(text);
    u.voice = pickVoice(gender);
    let pos = 0, timer = null;
    const reveal = (n) => { pos = Math.max(pos, Math.min(n, text.length)); onProgress(pos); };
    u.onstart = () => { timer = setInterval(() => reveal(pos + 1), 70); };
    u.onboundary = (e) => {
      clearInterval(timer);
      const end = text.slice(e.charIndex).search(/\s|$/);
      reveal(e.charIndex + (e.charLength || end));
    };
    const done = () => { clearInterval(timer); reveal(text.length); resolve(); };
    u.onend = u.onerror = done;
    speechSynthesis.speak(u);
  });
}
async function sayText(el, text, gender) {   // used for the greeting
  setStatus(true);
  await speakSentence(text, gender, (n) => { el.textContent = text.slice(0, n); scrollDown(); });
  el.textContent = text; setStatus(false);
}

$("muteBtn").onclick = () => {
  S.muted = !S.muted;
  if (S.muted) speechSynthesis.cancel();
  renderMute();
};
function renderMute() {
  $("muteBtn").setAttribute("aria-label", S.muted ? "Unmute voice" : "Mute voice");
  $("muteBtn").innerHTML = S.muted
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m17 9 5 5M22 9l-5 5"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>`;
}

/* ======================= rename a chat ======================= */
function startRename() {
  if (!S.chat || S.busy) return;
  $("titleInput").value = $("chatTitle").textContent;
  $("chatTitle").hidden = true; $("renameBtn").hidden = true; $("titleInput").hidden = false;
  $("titleInput").focus(); $("titleInput").select();
}
async function finishRename(save) {
  if ($("titleInput").hidden) return;
  const title = $("titleInput").value.trim();
  $("titleInput").hidden = true; $("chatTitle").hidden = false; $("renameBtn").hidden = false;
  if (!save || !title || title === $("chatTitle").textContent) return;
  $("chatTitle").textContent = title;
  try {
    await api(`/api/chats/${S.chat.id}`, { method: "PATCH", body: { title } });
    S.chat.title = title;
    await loadChats();
  } catch (err) { alert("Could not rename: " + err.message); }
}
$("renameBtn").onclick = startRename;
$("chatTitle").ondblclick = startRename;
$("titleInput").onkeydown = (e) => {
  if (e.key === "Enter") finishRename(true);
  if (e.key === "Escape") finishRename(false);
};
$("titleInput").onblur = () => finishRename(true);

/* ======================= model status (so failures aren't silent) ======================= */
async function checkModels() {
  let st;
  try { st = await api("/api/status"); } catch { return; }
  const problems = [];
  const name = { text_emotion: "Emotion from words", voice_emotion: "Emotion from voice", whisper: "Speech-to-text", llm: "Companion (Ollama)" };
  for (const [k, v] of Object.entries(st)) {
    if (v.startsWith("error")) problems.push(`<b>${name[k]}</b> failed: <code>${esc(v.slice(7))}</code>`);
    else if (v !== "ready") problems.push(`<b>${name[k]}</b> is still loading…`);
  }
  $("modelWarn").hidden = !problems.length;
  $("modelWarn").innerHTML = problems.join("<br>") + (problems.some((p) => p.includes("failed")) ? "<br>Full error in the terminal." : "");
  if (Object.values(st).some((v) => v === "loading" || v === "waiting")) setTimeout(checkModels, 4000);
}

/* ======================= sending a message ======================= */
function setBusy(b) {
  S.busy = b;
  $("sendBtn").disabled = b;
  $("micBtn").disabled = b;
}

async function send(text, source, voicePromise) {
  const chat = S.chat;
  setBusy(true);
  const user = addUser(text, source, null);
  const typing = addBot(`${chat.agent_name} is thinking...`, "typing");
  try {
    const res = await fetch(`/api/chats/${chat.id}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, source }),
    });
    if (!res.ok) throw new Error("Server error " + res.status);
    const msgId = res.headers.get("X-User-Message-Id");

    // emotion runs in the background: never makes the companion wait
    (async () => {
      const [v, t] = await Promise.all([voicePromise || null, textEmotion(text)]);
      const p = fuse(v, t);
      if (!p) { checkModels(); return; }        // show why there is no emotion
      setEmotionPanel(p, !!v);
      user.setTag(source, p);
      await api(`/api/messages/${msgId}/emotions`, { method: "PATCH", body: { emotions: p } }).catch(() => {});
      loadChats();
    })();

    // stream the reply; the bubble shows only what has already been spoken
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let reply = "", queued = 0, shown = 0, bubble = null;
    const speeches = [];
    const render = () => {
      if (S.muted) shown = reply.length;
      bubble.textContent = reply.slice(0, shown); scrollDown();
    };
    const queue = (sentence) => {
      const start = queued; queued += sentence.length;
      speeches.push(speakSentence(sentence, chat.gender, (n) => { shown = Math.max(shown, start + n); render(); }));
    };
    speechSynthesis.cancel();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!bubble) { typing.remove(); bubble = addBot(""); setStatus(true); }
      reply += decoder.decode(value, { stream: true });
      render();
      let m;
      while ((m = reply.slice(queued).match(/^[\s\S]*?[.!?]\s+/))) queue(m[0]);
    }
    if (reply.slice(queued).trim()) queue(reply.slice(queued));
    if (!bubble) { typing.remove(); bubble = addBot("..."); }
    await Promise.all(speeches);
    shown = reply.length; render();
  } catch (err) {
    typing.remove();
    addBot("Sorry, something went wrong: " + err.message);
  }
  setStatus(false);
  setBusy(false);
  await loadChats();
  const fresh = S.chats.find((c) => c.id === chat.id);
  if (fresh) $("chatTitle").textContent = fresh.title;
  if (S.mode === "writing") $("input").focus();
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("input").value.trim();
  if (!text || S.busy || !S.chat) return;
  $("input").value = "";
  send(text, "typed");
});

/* ======================= speaking mode ======================= */
let recorder = null, chunks = [];
$("micBtn").onclick = async () => {
  if (recorder && recorder.state === "recording") { recorder.stop(); return; }
  try {
    speechSynthesis.cancel();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      $("micBtn").classList.remove("recording");
      $("micHint").textContent = "Tap to talk";
      handleRecording(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.start();
    $("micBtn").classList.add("recording");
    $("micHint").textContent = "Listening... tap again when you finish";
  } catch (err) {
    $("micHint").textContent = "Microphone not available: " + err.message;
  }
};

async function handleRecording(blob) {
  setBusy(true);
  const voiceP = voiceEmotion(blob);           // tone of voice, in parallel
  const placeholder = addUser("Transcribing...", "spoken", null);
  placeholder.el.classList.add("pending");
  try {
    const form = new FormData(); form.append("audio", blob, "speech.webm");
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Server error " + res.status);
    placeholder.wrap.remove();
    if (!data.text) { $("micHint").textContent = "I didn't catch that, try again."; setBusy(false); return; }
    await send(data.text, "spoken", voiceP);
  } catch (err) {
    placeholder.wrap.remove();
    addBot("Sorry, transcription failed: " + err.message);
    setBusy(false);
  }
}

function setMode(m) {
  S.mode = m;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  $("form").hidden = m !== "writing";
  $("micRow").hidden = m !== "speaking";
}
document.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => !S.busy && setMode(b.dataset.mode));

$("deleteBtn").onclick = async () => {
  if (!S.chat || S.busy) return;
  if (!confirm(`Delete "${S.chat.title}" from your diary? This can't be undone.`)) return;
  await api(`/api/chats/${S.chat.id}`, { method: "DELETE" });
  S.chat = null;
  await loadChats();
  S.chats.length ? openChat(S.chats[0].id) : show("setup");
};

/* ======================= new chat setup ======================= */
document.querySelectorAll("[data-avatar]").forEach((el) => el.innerHTML = avatarSVG(el.dataset.avatar));
document.querySelectorAll(".gender-card").forEach((card) => card.onclick = () => {
  S.setup.gender = card.dataset.gender;
  document.querySelectorAll(".gender-card").forEach((c) => {
    const on = c === card;
    c.classList.toggle("selected", on); c.setAttribute("aria-checked", on);
  });
  $("agentNameInput").placeholder = S.setup.gender === "male" ? "Leo" : "Luna";
});
document.querySelectorAll("#personality button").forEach((b) => b.onclick = () => {
  S.setup.personality = b.dataset.p;
  document.querySelectorAll("#personality button").forEach((x) => x.classList.toggle("selected", x === b));
});
const setupName = () => $("agentNameInput").value.trim() || $("agentNameInput").placeholder;
$("sampleBtn").onclick = () => {
  speechSynthesis.cancel();
  speakSentence(`Hi, I'm ${setupName()}. I'm here whenever you want to talk.`, S.setup.gender, () => {});
};
$("startBtn").onclick = async () => {
  $("startBtn").disabled = true;
  try {
    const { id } = await api("/api/chats", { method: "POST",
      body: { agent_name: setupName(), gender: S.setup.gender, personality: S.setup.personality } });
    $("agentNameInput").value = "";
    await loadChats();
    await openChat(id);
    const bubbles = $("messages").querySelectorAll(".msg.bot");
    const greet = bubbles[bubbles.length - 1];
    if (greet) sayText(greet, greet.textContent, S.chat.gender);
  } catch (err) { alert("Could not start the chat: " + err.message); }
  $("startBtn").disabled = false;
};

/* ======================= dashboard ======================= */
document.querySelectorAll("#rangeSeg button").forEach((b) => b.onclick = () => {
  S.dashDays = +b.dataset.days;
  document.querySelectorAll("#rangeSeg button").forEach((x) => x.classList.toggle("active", x === b));
  loadDashboard();
});

function kpi(label, val, sub, color) {
  return `<div class="card kpi"><span class="k-label">${label}</span><span class="k-val" style="color:${color || "#1F2328"}">${val}</span><span class="k-sub">${sub}</span></div>`;
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function loadDashboard() {
  const d = await api(`/api/dashboard?days=${S.dashDays}`);
  const k = d.kpis;
  $("kpis").innerHTML =
    kpi("Diary chats", k.chats, S.dashDays === 7 ? "this week" : S.dashDays === 30 ? "this month" : "all time") +
    (k.most_felt ? kpi("Most felt", cap(k.most_felt.emotion), `${Math.round(k.most_felt.share * 100)}% of your messages`, COLORS[k.most_felt.emotion]) : kpi("Most felt", "–", "no data yet")) +
    (k.brightest ? kpi("Brightest chat", `Happy ${Math.round(k.brightest.happy * 100)}%`, esc(k.brightest.title), "#9A6312") : kpi("Brightest chat", "–", "no data yet")) +
    kpi("Mood after talking", k.lighter.of ? (k.lighter.count >= k.lighter.of / 2 ? "Lighter" : "Heavier") : "–",
        k.lighter.of ? `felt lighter in ${k.lighter.count} of ${k.lighter.of} chats` : "needs 2+ messages", "#1F4F52");

  // chat picker for the line chart
  const sel = $("chatSelect");
  const keep = sel.value;
  sel.innerHTML = d.chats.map((c) => `<option value="${c.id}">${esc(c.title)} · ${fmtWhen(c.updated_at)}</option>`).join("");
  if (S.chat && d.chats.some((c) => c.id === S.chat.id)) sel.value = S.chat.id;
  else if (keep && d.chats.some((c) => String(c.id) === keep)) sel.value = keep;
  sel.onchange = () => drawLine(+sel.value);
  if (d.chats.length) drawLine(+sel.value); else drawLine(null);

  drawMix(d.chats);

  $("moments").innerHTML = d.moments.length ? d.moments.map((m) =>
    `<div class="moment ${m.kind}"><b>${m.kind === "lifted" ? "Mood lifted" : "Heavier moment"}</b>
     <span>Difficult feelings went from ${Math.round(m.from * 100)}% to ${Math.round(m.to * 100)}% in “${esc(m.title)}”.</span></div>`).join("")
    : `<span class="muted small">Moments appear when your mood shifts clearly during a chat.</span>`;
}

function chartFont() { return { family: "'Plus Jakarta Sans', system-ui, sans-serif", size: 12 }; }

async function drawLine(chatId) {
  if (S.charts.line) S.charts.line.destroy();
  if (!chatId) { $("lineEmpty").hidden = false; return; }
  const { messages } = await api(`/api/chats/${chatId}`);
  const pts = messages.filter((m) => m.role === "user" && m.emotions);
  $("lineEmpty").hidden = pts.length > 0;
  if (!pts.length) return;
  // show the emotions that actually appear (peak >= 10%), at most 4
  const shown = EMOTIONS.map((e) => [e, Math.max(...pts.map((m) => m.emotions[e] || 0))])
    .filter(([, peak]) => peak >= 0.1).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e]) => e);
  S.charts.line = new Chart($("lineChart"), {
    type: "line",
    data: {
      labels: pts.map((_, i) => "#" + (i + 1)),
      datasets: shown.map((e) => ({
        label: cap(e), data: pts.map((m) => Math.round((m.emotions[e] || 0) * 100)),
        borderColor: COLORS[e], backgroundColor: "#fff", borderWidth: 3, pointRadius: 4, tension: .3,
        borderDash: e === "neutral" ? [6, 5] : [],
      })),
    },
    options: {
      maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + "%", font: chartFont() }, grid: { color: "#EFEBE4" } },
                x: { ticks: { font: chartFont() }, grid: { display: false } } },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, font: chartFont() } },
        tooltip: { callbacks: { title: (items) => {
          const t = pts[items[0].dataIndex].content; return t.length > 60 ? t.slice(0, 58) + "…" : t; } } },
      },
    },
  });
}

function drawMix(chats) {
  if (S.charts.mix) S.charts.mix.destroy();
  $("mixBox").style.height = Math.max(160, chats.length * 44 + 70) + "px";
  S.charts.mix = new Chart($("mixChart"), {
    type: "bar",
    data: {
      labels: chats.map((c) => c.title.length > 28 ? c.title.slice(0, 26) + "…" : c.title),
      datasets: EMOTIONS.map((e) => ({
        label: cap(e), data: chats.map((c) => Math.round((c.mix[e] || 0) * 100)),
        backgroundColor: COLORS[e], borderRadius: 4, barThickness: 18,
      })),
    },
    options: {
      indexAxis: "y", maintainAspectRatio: false,
      scales: { x: { stacked: true, max: 100, ticks: { callback: (v) => v + "%", font: chartFont() }, grid: { color: "#EFEBE4" } },
                y: { stacked: true, ticks: { font: chartFont() }, grid: { display: false } } },
      plugins: { legend: { position: "bottom", labels: { usePointStyle: true, font: chartFont() } } },
      onClick: (_, els) => { if (els.length) openChat(chats[els[0].index].id); },
    },
  });
}

/* ======================= start ======================= */
(async function init() {
  renderMute();
  setMode("writing");
  checkModels();
  speechSynthesis.getVoices();
  await loadChats();
  if (S.chats.length) await openChat(S.chats[0].id);
  else show("setup");
})();
