import assert from "node:assert/strict";
import fs from "node:fs";

const composer = fs.readFileSync(new URL("../components/Composer.tsx", import.meta.url), "utf8");
const en = fs.readFileSync(new URL("../locales/en.ts", import.meta.url), "utf8");
const zh = fs.readFileSync(new URL("../locales/zh.ts", import.meta.url), "utf8");
const zhTW = fs.readFileSync(new URL("../locales/zh-TW.ts", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

const visibleChinese = [
  "正在加载历史会话",
  "暂无历史会话",
  "搜索历史会话",
  "没有匹配的历史会话",
  "返回文件列表",
  "移除引用会话",
  "以下是用户引用的历史会话上下文",
  "当前用户问题",
  "该会话读取失败",
];

for (const text of visibleChinese) {
  assert.doesNotMatch(composer, new RegExp(text), `Composer should translate user-visible text: ${text}`);
}

const keys = [
  "composer.pastChatsLoading",
  "composer.pastChatsEmpty",
  "composer.pastChatsSearch",
  "composer.pastChatsNoMatches",
  "composer.pastChatsTurns",
  "composer.pastChatsBackToFiles",
  "composer.pastChatsRemove",
  "composer.sessionContextHeader",
  "composer.sessionContextFooter",
  "composer.sessionContextSession",
  "composer.sessionContextUser",
  "composer.sessionContextAssistant",
  "composer.sessionContextTruncated",
  "composer.sessionContextEmpty",
  "composer.sessionContextFailed",
  "todo.knownTitle",
  "todo.unknownTitle",
  "todo.knownEmpty",
  "todo.unknownEmpty",
];

for (const key of keys) {
  const pattern = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  assert.match(en, pattern, `English dictionary should include ${key}`);
  assert.match(zh, pattern, `Chinese dictionary should include ${key}`);
  assert.match(zhTW, pattern, `Traditional Chinese dictionary should include ${key}`);
}

for (const [dictionary, copies] of [
  [en, ["Known", "Unknown", "No confirmed information yet", "No important unknowns right now"]],
  [zh, ["已知内容", "未知内容", "暂无已确认内容", "暂无影响结论的未知项"]],
  [zhTW, ["已知內容", "未知內容", "暫無已確認內容", "暫無影響結論的未知項"]],
] as const) {
  for (const copy of copies) assert.match(dictionary, new RegExp(copy));
}

assert.match(composer, /buildSessionContext\(currentSessionRefs, t\)/);
assert.match(en, /"settings\.tab\.models": "Models & API"/);
assert.match(zh, /"settings\.tab\.models": "模型与 API"/);
assert.match(zhTW, /"settings\.tab\.models": "模型與 API"/);
assert.match(app, /id: "cmd-models"[\s\S]+setSettingsTarget\("models"\)/);

console.log("Pathfinder bilingual contract passed");
