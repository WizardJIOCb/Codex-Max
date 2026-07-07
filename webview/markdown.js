function renderPlainText(value) {
  return '<p>' + escapeHtml(value).replace(/\n/g, "<br>") + '</p>';
}

function renderMarkdown(value) {
  const text = String(value || "");
  const parts = [];
  const ticks = String.fromCharCode(96, 96, 96);
  const tick = String.fromCharCode(96);
  const fence = new RegExp(ticks + "([^\\n" + tick + "]*)\\n?([\\s\\S]*?)" + ticks, "g");
  let lastIndex = 0;
  let match;

  while ((match = fence.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderMarkdownText(text.slice(lastIndex, match.index)));
    }

    const lang = String(match[1] || "").trim();
    const code = match[2] || "";
    parts.push(renderCodeBlock(code.trim(), lang));
    lastIndex = fence.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(renderMarkdownText(text.slice(lastIndex)));
  }

  return parts.join("");
}

function renderMarkdownText(value) {
  const blocks = String(value || "").replace(/^\n+|\n+$/g, "").split(/\n{2,}/);
  if (!blocks.length || (blocks.length === 1 && !blocks[0])) {
    return "";
  }

  let html = "";
  let index = 0;

  while (index < blocks.length) {
    const looseList = renderLooseMarkdownList(blocks, index);
    if (looseList) {
      html += looseList.html;
      index = looseList.next;
      continue;
    }

    html += renderMarkdownBlock(blocks[index]);
    index += 1;
  }

  return html;
}

function renderMarkdownBlock(block) {
  const lines = blockLines(block);
  if (!lines.length) {
    return "";
  }

  if (lines.every((line) => /^\s*[-*_]{3,}\s*$/.test(line))) {
    return "<hr>";
  }

  if (lines.every((line) => /^    /.test(line))) {
    return renderCodeBlock(lines.map((line) => line.replace(/^    /, "")).join("\n"), "");
  }

  if (lines[0].trim() === "\\[" && lines[lines.length - 1].trim() === "\\]") {
    return '<div class="mathBlock">' + escapeHtml(lines.slice(1, -1).join("\n")) + '</div>';
  }

  if (isMarkdownTable(lines)) {
    return renderMarkdownTable(lines);
  }

  if (isHtmlDetailsBlock(lines)) {
    return renderHtmlDetailsBlock(lines);
  }

  if (isDefinitionList(lines)) {
    return renderDefinitionList(lines);
  }

  if (lines.every((line) => /^\s*>\s?/.test(line))) {
    return '<blockquote>' + renderMarkdownText(lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n")) + '</blockquote>';
  }

  if (isPureMarkdownListBlock(lines)) {
    return renderMarkdownList(lines);
  }

  if (/^#{1,4}\s+/.test(lines[0]) && lines.length === 1) {
    const level = Math.min(4, lines[0].match(/^#+/)[0].length + 2);
    return '<h' + level + '>' + renderInlineMarkdown(lines[0].replace(/^#{1,4}\s+/, "")) + '</h' + level + '>';
  }

  return renderMixedMarkdownLines(lines);
}

function blockLines(block) {
  return String(block || "").split(/\n/).filter((line) => line.trim().length);
}

function renderCodeBlock(code, lang) {
  const normalized = normalizeCodeLanguage(lang);
  const langAttr = lang ? ' data-lang="' + escapeAttr(lang) + '"' : "";
  const langClass = normalized ? " hasCodeLang language-" + escapeAttr(normalized) : "";
  const label = normalized ? '<span class="codeLang">' + escapeHtml(normalized) + '</span>' : "";
  return '<pre class="codeBlock' + langClass + '">' + label + '<code' + langAttr + '>' + syntaxHighlightCode(code, normalized) + '</code></pre>';
}

function normalizeCodeLanguage(lang) {
  const value = String(lang || "").trim().toLowerCase().split(/\s+/)[0];
  const aliases = {
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    ps1: "powershell",
    pwsh: "powershell",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    htm: "html"
  };
  return aliases[value] || value;
}

function syntaxHighlightCode(code, lang) {
  const sourceLang = normalizeCodeLanguage(lang);
  let source = String(code || "");
  if (!source.trim()) {
    return "";
  }

  const tokens = [];
  const protect = (pattern, className) => {
    source = source.replace(pattern, (match) => {
      const id = tokens.length;
      tokens.push('<span class="' + className + '">' + escapeHtml(match) + '</span>');
      return "\uE000" + id + "\uE001";
    });
  };

  if (sourceLang === "html" || sourceLang === "xml") {
    protect(/<!--[\s\S]*?-->/g, "shComment");
    protect(/<\/?[A-Za-z][^>\n]*?>/g, "shTag");
  } else if (sourceLang === "css") {
    protect(/\/\*[\s\S]*?\*\//g, "shComment");
    protect(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "shString");
    protect(/\b(?:#[0-9a-fA-F]{3,8}|-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms)?)\b/g, "shNumber");
    protect(/\b(?:display|position|grid|flex|block|none|color|background|border|padding|margin|width|height|font|transform|transition|animation|content|overflow|z-index|opacity)\b/g, "shKeyword");
  } else {
    if (sourceLang === "python" || sourceLang === "bash" || sourceLang === "powershell" || sourceLang === "yaml") {
      protect(/#[^\n]*/g, "shComment");
    } else if (sourceLang !== "json") {
      protect(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "shComment");
    }
    if (sourceLang === "json" || sourceLang === "yaml") {
      protect(/"(?:\\.|[^"\\])*"(?=\s*:)/g, "shProperty");
    }
    protect(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "shString");
    protect(/\b(?:true|false|null|undefined|NaN|Infinity)\b/g, "shLiteral");
    protect(/\b-?\d+(?:\.\d+)?\b/g, "shNumber");
    protect(keywordPatternForLanguage(sourceLang), "shKeyword");
  }

  let html = escapeHtml(source);
  html = html.replace(/\uE000(\d+)\uE001/g, (match, id) => tokens[Number(id)] || match);
  return html;
}

function keywordPatternForLanguage(lang) {
  const sets = {
    javascript: "async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|switch|throw|try|typeof|var|void|while|yield",
    typescript: "abstract|any|as|async|await|boolean|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|let|namespace|new|of|private|protected|public|readonly|return|static|string|switch|throw|try|type|typeof|var|void|while|yield",
    python: "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield",
    powershell: "begin|break|catch|class|continue|data|do|dynamicparam|else|elseif|end|exit|filter|finally|for|foreach|from|function|if|in|param|process|return|switch|throw|trap|try|until|using|var|while",
    bash: "case|do|done|elif|else|esac|export|fi|for|function|if|in|local|return|select|then|until|while",
    json: "",
    yaml: "true|false|null"
  };
  const words = sets[lang] || sets.javascript;
  return words ? new RegExp("\\b(?:" + words + ")\\b", "g") : /$a/;
}

function renderMixedMarkdownLines(lines) {
  let html = "";
  let paragraph = [];
  let index = 0;

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }

    html += '<p>' + paragraph.map(renderInlineMarkdown).join("<br>") + '</p>';
    paragraph = [];
  };

  while (index < lines.length) {
    if (parseMarkdownListItem(lines[index])) {
      flushParagraph();
      const listLines = [];
      while (index < lines.length && parseMarkdownListItem(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      html += renderMarkdownList(listLines);
      continue;
    }

    paragraph.push(lines[index]);
    index += 1;
  }

  flushParagraph();
  return html;
}

function isMarkdownTable(lines) {
  if (lines.length < 2 || !lines[0].includes("|")) {
    return false;
  }

  const separator = splitMarkdownTableRow(lines[1]);
  return separator.length > 1 && separator.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownTable(lines) {
  const headers = splitMarkdownTableRow(lines[0]);
  const rows = lines.slice(2).map(splitMarkdownTableRow).filter((row) => row.length);
  const head = '<thead><tr>' + headers.map((cell) => '<th>' + renderInlineMarkdown(cell) + '</th>').join("") + '</tr></thead>';
  const body = rows.length ? '<tbody>' + rows.map((row) => {
    const cells = headers.map((_, index) => row[index] || "");
    return '<tr>' + cells.map((cell) => '<td>' + renderInlineMarkdown(cell) + '</td>').join("") + '</tr>';
  }).join("") + '</tbody>' : "";

  return '<table>' + head + body + '</table>';
}

function splitMarkdownTableRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseMarkdownListItem(line) {
  const source = String(line || "");
  let match = source.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/);
  if (match) {
    return {
      indent: match[1].replace(/\t/g, "    ").length,
      type: "task",
      checked: /x/i.test(match[2]),
      text: match[3]
    };
  }

  match = source.match(/^(\s*)[-*]\s+(.+)$/);
  if (match) {
    return {
      indent: match[1].replace(/\t/g, "    ").length,
      type: "ul",
      checked: false,
      text: match[2]
    };
  }

  match = source.match(/^(\s*)\d+[.)]\s+(.+)$/);
  if (match) {
    return {
      indent: match[1].replace(/\t/g, "    ").length,
      type: "ol",
      checked: false,
      text: match[2]
    };
  }

  return null;
}

function isPureMarkdownListBlock(lines) {
  return Array.isArray(lines) && lines.length > 0 && lines.every((line) => parseMarkdownListItem(line));
}

function renderLooseMarkdownList(blocks, start) {
  const firstLines = blockLines(blocks[start]);
  if (!isPureMarkdownListBlock(firstLines)) {
    return null;
  }

  const firstItem = parseMarkdownListItem(firstLines[0]);
  if (!firstItem) {
    return null;
  }

  const entries = [];
  let index = start;
  let hasLooseContinuation = false;

  while (index < blocks.length) {
    const lines = blockLines(blocks[index]);
    if (!isPureMarkdownListBlock(lines) || !isMatchingRootListBlock(lines, firstItem)) {
      break;
    }

    appendLooseListEntries(entries, lines, firstItem);
    index += 1;

    const continuation = [];
    let probe = index;
    while (probe < blocks.length) {
      const nextLines = blockLines(blocks[probe]);
      if (isPureMarkdownListBlock(nextLines)) {
        break;
      }
      if (!entries.length) {
        break;
      }

      continuation.push(blocks[probe]);
      probe += 1;
    }

    if (continuation.length) {
      const nextLines = blockLines(blocks[probe]);
      const continuesSameList = probe < blocks.length && isPureMarkdownListBlock(nextLines) && isMatchingRootListBlock(nextLines, firstItem);
      if (!continuesSameList && !hasLooseContinuation) {
        break;
      }

      entries[entries.length - 1].continuation.push(...continuation);
      hasLooseContinuation = true;
      index = probe;
    }
  }

  if (!entries.length) {
    return null;
  }

  return {
    html: renderLooseListEntries(entries, firstItem.type),
    next: index
  };
}

function isMatchingRootListBlock(lines, rootItem) {
  const first = parseMarkdownListItem(lines[0]);
  return first && first.indent === rootItem.indent && first.type === rootItem.type;
}

function appendLooseListEntries(entries, lines, rootItem) {
  const items = lines.map(parseMarkdownListItem).filter(Boolean);
  let current = null;

  for (const item of items) {
    if (item.indent === rootItem.indent && item.type === rootItem.type) {
      current = {
        item,
        children: [],
        continuation: []
      };
      entries.push(current);
      continue;
    }

    if (current) {
      current.children.push(item);
    }
  }
}

function renderLooseListEntries(entries, type) {
  const tag = type === "ol" ? "ol" : "ul";
  const className = type === "task" ? ' class="taskList"' : "";
  return "<" + tag + className + ">" + entries.map(renderLooseListEntry).join("") + "</" + tag + ">";
}

function renderLooseListEntry(entry) {
  let content = renderMarkdownListItemContent(entry.item);
  if (entry.children.length) {
    const child = renderMarkdownListLevel(entry.children, 0, entry.children[0].indent, entry.children[0].type);
    content += child.html;
  }
  if (entry.continuation.length) {
    content += renderMarkdownText(entry.continuation.join("\n\n"));
  }

  return "<li>" + content + "</li>";
}

function renderMarkdownList(lines) {
  const items = lines.map(parseMarkdownListItem).filter(Boolean);
  let html = "";
  let index = 0;

  while (index < items.length) {
    const result = renderMarkdownListLevel(items, index, items[index].indent, items[index].type);
    html += result.html;
    index = result.next;
  }

  return html;
}

function renderMarkdownListLevel(items, start, indent, type) {
  const tag = type === "ol" ? "ol" : "ul";
  const className = type === "task" ? ' class="taskList"' : "";
  let html = "<" + tag + className + ">";
  let index = start;

  while (index < items.length) {
    const item = items[index];
    if (item.indent < indent || (item.indent === indent && item.type !== type)) {
      break;
    }
    if (item.indent > indent) {
      break;
    }

    let content = renderMarkdownListItemContent(item);
    index += 1;

    while (index < items.length && items[index].indent > indent) {
      const child = renderMarkdownListLevel(items, index, items[index].indent, items[index].type);
      content += child.html;
      index = child.next;
    }

    html += "<li>" + content + "</li>";
  }

  html += "</" + tag + ">";
  return { html, next: index };
}

function renderMarkdownListItemContent(item) {
  if (item.type !== "task") {
    return renderInlineMarkdown(item.text);
  }

  const checkedClass = item.checked ? " checked" : "";
  const check = item.checked ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"></path></svg>' : "";
  return '<span class="taskBox' + checkedClass + '" aria-hidden="true">' + check + '</span><span>' + renderInlineMarkdown(item.text) + '</span>';
}

function isDefinitionList(lines) {
  if (lines.length < 2 || lines.length % 2 !== 0) {
    return false;
  }

  for (let index = 1; index < lines.length; index += 2) {
    if (!/^\s*:\s+/.test(lines[index])) {
      return false;
    }
  }

  return true;
}

function renderDefinitionList(lines) {
  let html = "<dl>";
  for (let index = 0; index < lines.length; index += 2) {
    html += "<dt>" + renderInlineMarkdown(lines[index].trim()) + "</dt>";
    html += "<dd>" + renderInlineMarkdown(lines[index + 1].replace(/^\s*:\s+/, "")) + "</dd>";
  }
  return html + "</dl>";
}

function isHtmlDetailsBlock(lines) {
  return /^\s*<details>\s*$/i.test(lines[0]) && /^\s*<\/details>\s*$/i.test(lines[lines.length - 1]);
}

function renderHtmlDetailsBlock(lines) {
  const inner = lines.slice(1, -1);
  let summary = "Details";
  const body = [];

  for (const line of inner) {
    const match = line.match(/^\s*<summary>([\s\S]*)<\/summary>\s*$/i);
    if (match) {
      summary = match[1];
    } else {
      body.push(line);
    }
  }

  return '<details><summary>' + renderInlineMarkdown(summary) + '</summary>' + renderMarkdownText(body.join("\n")) + '</details>';
}

function renderInlineMarkdown(value) {
  const tick = String.fromCharCode(96);
  const inlineCode = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");
  const link = /(!?)\[([^\]]+)\]\((<[^>]+>|[^)]+)\)/g;
  const source = String(value || "");
  let output = "";
  let lastIndex = 0;
  let match;

  while ((match = link.exec(source)) !== null) {
    if (match.index > lastIndex) {
      output += renderBasicInline(source.slice(lastIndex, match.index), inlineCode);
    }

    const isImage = match[1] === "!";
    const label = match[2] || match[3] || "file";
    const target = normalizeMarkdownLinkTarget(match[3]);

    if (isImage) {
      output += isPreviewableImageTarget(target)
        ? renderImagePreview(target, label, inlineCode)
        : '<span class="imageReference" title="' + escapeAttr(target) + '">Image: <strong>' + renderBasicInline(label, inlineCode) + '</strong></span>';
    } else if (/^https?:\/\//i.test(target)) {
      output += '<button class="inlineLink" data-open-url="' + escapeAttr(target) + '" title="' + escapeAttr(target) + '">' + renderBasicInline(label, inlineCode) + '</button>';
    } else {
      output += '<button class="inlineLink" data-open-file="' + escapeAttr(target) + '" title="' + escapeAttr(target) + '">' + renderBasicInline(label, inlineCode) + '</button>';
    }
    lastIndex = link.lastIndex;
  }

  if (lastIndex < source.length) {
    output += renderBasicInline(source.slice(lastIndex), inlineCode);
  }

  return output;
}

function renderBasicInline(value, inlineCode) {
  const source = String(value || "");
  let output = "";
  let lastIndex = 0;
  let match;

  inlineCode.lastIndex = 0;
  while ((match = inlineCode.exec(source)) !== null) {
    if (match.index > lastIndex) {
      output += renderInlineDecorations(escapeHtml(source.slice(lastIndex, match.index)));
    }

    output += isPreviewableImageTarget(match[1])
      ? renderImagePreview(match[1], imageLabel(match[1]), inlineCode)
      : "<code>" + escapeHtml(match[1]) + "</code>";
    lastIndex = inlineCode.lastIndex;
  }

  if (lastIndex < source.length) {
    output += renderInlineDecorations(escapeHtml(source.slice(lastIndex)));
  }

  return output;
}

function isPreviewableImageTarget(value) {
  const target = String(value || "").trim();
  if (!target || /^https?:\/\//i.test(target)) {
    return false;
  }

  return /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(target);
}

function renderImagePreview(target, label, inlineCode) {
  const caption = label || imageLabel(target);
  return '<span class="imagePreviewFrame">' +
    '<button class="imagePreviewButton" type="button" data-image-open="true" data-image-path="' + escapeAttr(target) + '" data-image-caption="' + escapeAttr(caption) + '" title="Open image preview: ' + escapeAttr(target) + '">' +
    '<span class="imagePreviewPlaceholder">Loading image...</span>' +
    '<img hidden alt="' + escapeAttr(caption) + '">' +
    '<span class="imagePreviewCaption">' + renderInlineDecorations(escapeHtml(caption)) + '</span>' +
    '</button>' +
    '</span>';
}

function renderChangeDetails(item) {
  const changes = Array.isArray(item.changes) ? item.changes.filter((change) => change.path) : [];
  const rows = changes.length
    ? changes.map(renderChangeFileRow).join("")
    : "";
  const diff = changes.map((change) => change.diff).filter(Boolean).join("\n\n");
  const body = diff
    ? renderDiffBlock(diff)
    : '<div class="changeEmpty">No textual diff was available for this file change.</div>';

  return rows + body;
}

function renderDiffBlock(value) {
  const lines = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => !/^(---|\+\+\+)\s/.test(line))
    .map(renderDiffLine)
    .join("");
  return '<pre class="changeDiff">' + lines + '</pre>';
}

function renderDiffLine(line) {
  let cls = "diffContext";
  let changeAttr = "";
  if (/^@@/.test(line)) {
    cls = "diffHunk";
  } else if (/^\+/.test(line)) {
    cls = "diffAdd";
    changeAttr = ' data-diff-change="true"';
  } else if (/^-/.test(line)) {
    cls = "diffDelete";
    changeAttr = ' data-diff-change="true"';
  }

  return '<span class="diffLine ' + cls + '"' + changeAttr + '>' + escapeHtml(line || " ") + '</span>';
}

function renderChangeFileRow(change) {
  const counts = changeCountsHtml(change);
  return `
    <div class="changeFileRow">
      <span class="changeFilePath" title="${escapeAttr(change.path)}">${escapeHtml(change.path)}</span>
      <span class="changeTools">
        <span class="changeCounts">${counts || escapeHtml(change.kind || "edited")}</span>
        <span class="diffNav" aria-label="Diff navigation">
          <button class="diffNavButton" type="button" data-diff-nav="prev" title="Previous change" aria-label="Previous change">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10.5 8 6l4 4.5"></path></svg>
          </button>
          <button class="diffNavButton" type="button" data-diff-nav="next" title="Next change" aria-label="Next change">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 5.5 4 4.5 4-4.5"></path></svg>
          </button>
        </span>
      </span>
    </div>
  `;
}

function changeCountsHtml(change) {
  const parts = [];
  if (change.additions !== null && change.additions !== undefined) {
    parts.push('<span class="changeAdd">+' + escapeHtml(change.additions) + '</span>');
  }
  if (change.deletions !== null && change.deletions !== undefined) {
    parts.push('<span class="changeDelete">-' + escapeHtml(change.deletions) + '</span>');
  }
  return parts.join(" ");
}

function imageLabel(value) {
  const clean = String(value || "").replace(/[?#].*$/, "");
  return clean.split(/[\\/]/).pop() || clean || "image";
}

function renderInlineDecorations(value) {
  return renderAutolinks(renderAllowedInlineHtml(renderBold(renderInlineMath(value))));
}

function renderInlineMath(value) {
  return String(value).replace(/\\\(([^\n]+?)\\\)/g, '<span class="mathInline">$1</span>');
}

function renderBold(value) {
  return String(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function renderAllowedInlineHtml(value) {
  return String(value)
    .replace(/&lt;(kbd|sub|sup|mark)&gt;([\s\S]*?)&lt;\/\1&gt;/gi, "<$1>$2</$1>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>");
}

function renderAutolinks(value) {
  return String(value)
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<]+)/g, (match, prefix, url) => {
      const clean = url.replace(/[.,;:!?)]$/, "");
      const suffix = url.slice(clean.length);
      return prefix + '<button class="inlineLink" data-open-url="' + escapeAttr(clean) + '" title="' + escapeAttr(clean) + '">' + escapeHtml(clean) + '</button>' + suffix;
    })
    .replace(/(^|[\s(])([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, '$1<span class="inlineEmail">$2</span>');
}


function normalizeMarkdownLinkTarget(value) {
  let target = String(value || "").trim();
  target = target.replace(/^<|>$/g, "");
  target = target.replace(/&lt;|&gt;/g, "");
  if (/^\/[A-Za-z]:/.test(target)) {
    target = target.slice(1);
  }

  return target;
}
