import { escapeHtml } from "./api.js";

export function renderMarkdown(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      html.push("<hr>");
      i += 1;
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
      const level = Math.min(match[1].length + 2, 6);
      html.push(`<h${level}>${renderInline(match[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const tableLines = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && looksLikeTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      html.push(renderTable(tableLines));
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      html.push(`<blockquote>${renderMarkdown(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""));
        i += 1;
      }
      html.push(`<ul>${items.map(item => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i += 1;
      }
      html.push(`<ol>${items.map(item => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && shouldContinueParagraph(lines, i)) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    html.push(`<p>${renderInline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
  }

  return html.join("");
}

function shouldContinueParagraph(lines, index) {
  const trimmed = lines[index].trim();
  if (!trimmed) return false;
  if (isTableStart(lines, index)) return false;
  if (/^(```|#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/.test(trimmed)) return false;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return false;
  return true;
}

function isTableStart(lines, index) {
  return looksLikeTableRow(lines[index]) && isTableSeparator(lines[index + 1] || "");
}

function looksLikeTableRow(line) {
  const trimmed = (line || "").trim();
  return trimmed.includes("|") && splitTableRow(trimmed).length >= 2;
}

function isTableSeparator(line) {
  const cells = splitTableRow((line || "").trim());
  return cells.length >= 2 && cells.every(cell => /^:?-{2,}:?$/.test(cell.trim()));
}

function renderTable(tableLines) {
  const headers = splitTableRow(tableLines[0]);
  const rows = tableLines.slice(2).map(splitTableRow).filter(row => row.length);
  const thead = headers.map(cell => `<th>${renderInline(cell)}</th>`).join("");
  const tbody = rows.map(row => {
    const cells = headers.map((_, index) => `<td>${renderInline(row[index] || "")}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
}

function splitTableRow(line) {
  return String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

function renderInline(raw) {
  const codeTokens = [];
  let text = String(raw ?? "").replace(/`([^`]+)`/g, (_, code) => {
    const token = `%%INLINECODE${codeTokens.length}%%`;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  text = escapeHtml(text)
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");

  codeTokens.forEach((html, index) => {
    text = text.replace(`%%INLINECODE${index}%%`, html);
  });
  return text.replace(/@@INLINE_?CODE_?\d+@@/g, "");
}
