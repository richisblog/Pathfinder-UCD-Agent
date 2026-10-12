import { apiUrl, escapeHtml, logout, requireAuthenticated, safeJson } from "./api.js";
import { applyStaticTranslations, createTranslator, getStoredLanguage, setStoredLanguage } from "./i18n.js";
import { renderMarkdown } from "./markdown.js";

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const newChatBtn = document.getElementById("newChatBtn");
const sessionListEl = document.getElementById("sessionList");
const logoutBtn = document.getElementById("logoutBtn");

const ACTIVE_THREAD_KEY = "pathfinder.ucd.chat.activeThreadId.v1";

let threads = [];
let activeThreadId = null;
let t = createTranslator();

const authState = await requireAuthenticated({ profileRequired: true });
if (authState) {
  const language = setStoredLanguage(authState.profile?.language || getStoredLanguage());
  t = createTranslator(language);
  applyStaticTranslations(document, language);
  document.title = t("chatPageTitle");
  initializeChatPage();
}

async function initializeChatPage() {
  sendBtn.onclick = sendMessage;
  newChatBtn.onclick = createNewThread;
  logoutBtn.onclick = logout;
  inputEl.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  inputEl.addEventListener("input", resizeInput);
  await loadThreads();
  showFileModeNotice();
}

async function loadThreads(preferredThreadId = readLocalValue(ACTIVE_THREAD_KEY, null)) {
  const res = await fetch(apiUrl("/api/chat/threads"));
  if (res.status === 401) return location.assign("/login");
  if (res.status === 428) return location.assign("/onboarding");
  const data = await safeJson(res);
  threads = Array.isArray(data.threads) ? data.threads : [];
  if (!threads.length) {
    const created = await createThreadOnServer(t("newChat"));
    if (created) threads = [created];
  }
  activeThreadId = threads.some(thread => thread.id === preferredThreadId)
    ? preferredThreadId
    : threads[0]?.id || null;
  if (activeThreadId) writeLocalValue(ACTIVE_THREAD_KEY, activeThreadId);
  renderThreadList();
  await renderActiveThread();
}

async function createNewThread() {
  if (sendBtn.disabled) return;
  const thread = await createThreadOnServer(t("newChat"));
  if (!thread) return;
  activeThreadId = thread.id;
  writeLocalValue(ACTIVE_THREAD_KEY, activeThreadId);
  await loadThreads(activeThreadId);
}

async function createThreadOnServer(title) {
  const res = await fetch(apiUrl("/api/chat/threads"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) return null;
  return (await safeJson(res)).thread || null;
}

async function renderActiveThread() {
  messagesEl.innerHTML = "";
  if (!activeThreadId) {
    addMessage("assistant", t("chatWelcome"), { timestamp: "" });
    return;
  }
  const res = await fetch(apiUrl(`/api/chat/threads/${encodeURIComponent(activeThreadId)}/messages`));
  if (res.status === 404) {
    await loadThreads(null);
    return;
  }
  const data = await safeJson(res);
  const messages = Array.isArray(data.messages) ? data.messages : [];
  if (!messages.length) {
    addMessage("assistant", t("chatWelcome"), { timestamp: "" });
    return;
  }
  messages.forEach(message => addMessage(message.role, message.content, { timestamp: message.created_at }));
}

function addMessage(role, content, options = {}) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.innerHTML = `
    <div class="avatar">${role === "user" ? "U" : "AI"}</div>
    <div class="message-stack">
      <div class="bubble markdown-body"></div>
      <div class="message-time">${escapeHtml(formatTimestamp(options.timestamp))}</div>
    </div>
  `;
  const bubble = article.querySelector(".bubble");
  if (role === "assistant") bubble.innerHTML = renderMarkdown(content);
  else bubble.textContent = content;
  messagesEl.appendChild(article);
  scrollToBottom();
  return article;
}

function createAssistantStreamMessage() {
  const article = document.createElement("article");
  article.className = "message assistant";
  article.innerHTML = `
    <div class="avatar">AI</div>
    <div class="message-stack">
      <div class="tool-events" aria-live="polite"></div>
      <div class="bubble markdown-body streaming"></div>
      <div class="message-time"></div>
    </div>
  `;
  messagesEl.appendChild(article);
  scrollToBottom();
  return {
    toolsEl: article.querySelector(".tool-events"),
    bubble: article.querySelector(".bubble"),
    timeEl: article.querySelector(".message-time"),
  };
}

async function sendMessage() {
  const message = inputEl.value.trim();
  if (!message || !activeThreadId) return;
  inputEl.value = "";
  resizeInput();
  addMessage("user", message, { timestamp: new Date().toISOString() });
  setBusy(true);

  const streamMessage = createAssistantStreamMessage();
  let answer = "";

  try {
    const res = await fetch(apiUrl(`/api/chat/threads/${encodeURIComponent(activeThreadId)}/messages/stream`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (res.status === 401) return location.assign("/login");
    if (res.status === 428) return location.assign("/onboarding");
    if (res.status === 429) {
      const data = await safeJson(res);
      throw new Error(data.error || t("dailyLimitReached"));
    }
    if (!res.ok || !res.body) {
      const data = await safeJson(res);
      throw new Error(data.error || t("chatFailed"));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "tool_start") addToolEvent(streamMessage.toolsEl, "running", event.label, event.args);
        else if (event.type === "tool_result") addToolEvent(streamMessage.toolsEl, "done", event.label, event.summary);
        else if (event.type === "warning") addToolEvent(streamMessage.toolsEl, "warning", t("notice"), event.message);
        else if (event.type === "delta") {
          answer += event.content;
          streamMessage.bubble.innerHTML = renderMarkdown(answer);
          scrollToBottom();
        } else if (event.type === "error") {
          throw new Error(event.message || t("streamFailed"));
        }
      }
    }
    streamMessage.bubble.classList.remove("streaming");
    streamMessage.bubble.innerHTML = renderMarkdown(answer || `(${t("noAnswer")})`);
    streamMessage.timeEl.textContent = formatTimestamp(new Date().toISOString());
    await loadThreads(activeThreadId);
  } catch (error) {
    streamMessage.bubble.classList.remove("streaming");
    streamMessage.bubble.innerHTML = renderMarkdown(`**${t("connectionFailed")}**: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function renderThreadList() {
  sessionListEl.innerHTML = "";
  if (!threads.length) {
    const empty = document.createElement("div");
    empty.className = "session-meta";
    empty.textContent = t("chatEmpty");
    sessionListEl.appendChild(empty);
    return;
  }
  threads.forEach(thread => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `session-item${thread.id === activeThreadId ? " active" : ""}`;
    item.dataset.threadId = thread.id;
    item.innerHTML = `
      <span>
        <span class="session-title">${escapeHtml(thread.title || t("newChat"))}</span>
        <span class="session-meta">${escapeHtml(formatTimestamp(thread.updated_at))}</span>
      </span>
      <span class="session-delete" title="${escapeHtml(t("deleteChat"))}" aria-label="${escapeHtml(t("deleteChat"))}">&times;</span>
    `;
    item.addEventListener("click", async event => {
      if (event.target.closest(".session-delete")) {
        await deleteThread(thread.id);
        return;
      }
      activeThreadId = thread.id;
      writeLocalValue(ACTIVE_THREAD_KEY, activeThreadId);
      renderThreadList();
      await renderActiveThread();
    });
    sessionListEl.appendChild(item);
  });
}

async function deleteThread(threadId) {
  if (sendBtn.disabled) return;
  await fetch(apiUrl(`/api/chat/threads/${encodeURIComponent(threadId)}`), { method: "DELETE" });
  if (activeThreadId === threadId) activeThreadId = null;
  await loadThreads(activeThreadId);
}

function addToolEvent(container, state, label, detail) {
  if (state === "done") {
    const existing = Array.from(container.querySelectorAll(".tool-event.running"))
      .reverse()
      .find(item => item.dataset.label === label);
    if (existing) {
      existing.className = "tool-event done";
      existing.querySelector(".tool-detail").textContent = formatToolDetail(detail);
      return;
    }
  }

  const item = document.createElement("div");
  item.className = `tool-event ${state}`;
  item.dataset.label = label || t("tool");
  item.innerHTML = `
    <span class="tool-dot"></span>
    <span class="tool-label">${escapeHtml(label || t("tool"))}</span>
    <span class="tool-detail">${escapeHtml(formatToolDetail(detail))}</span>
  `;
  container.appendChild(item);
  scrollToBottom();
}

function formatToolDetail(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return detail.replace(/\s+/g, " ").trim();
  if (Array.isArray(detail.keywords)) return t("toolCheckingComments", { keywords: detail.keywords.slice(0, 4).join(", ") });
  if (detail.table && detail.sort_by) return t("toolSortedBy", { table: detail.table, sortBy: detail.sort_by });
  if (detail.table) return detail.table;
  if (detail.query) return t("toolQuery", { query: detail.query });
  if (detail.course) return t("toolCourse", { course: detail.course });
  return "";
}

function setBusy(isBusy) {
  sendBtn.disabled = isBusy;
  sendBtn.textContent = isBusy ? t("sending") : t("send");
  inputEl.disabled = isBusy;
  newChatBtn.disabled = isBusy;
  document.body.classList.toggle("chat-busy", isBusy);
}

function resizeInput() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 170)}px`;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function readLocalValue(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeLocalValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in private mode or when quota is full.
  }
}

function showFileModeNotice() {
  if (location.protocol !== "file:") return;
  addMessage("assistant", t("fileModeNotice"));
}
