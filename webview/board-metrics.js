// Board usage, account limits, and context window metrics. Loaded before chat rendering.
function estimateTokensForRoles(chat, roles) {
  const accepted = new Set(roles);
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  let chars = 0;
  let overhead = 0;

  for (const message of messages) {
    if (!accepted.has(String(message.role || ""))) {
      continue;
    }

    chars += String(message.text || "").length;
    chars += String(message.title || "").length;
    chars += String(message.detail || "").length;
    overhead += 12;
  }

  return Math.max(0, Math.ceil(chars / 4) + overhead);
}

function estimateAttachmentTokens(chat) {
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  let chars = 0;
  let overhead = 0;

  for (const attachment of attachments) {
    chars += String(attachment.name || "").length;
    chars += String(attachment.path || "").length;
    chars += String(attachment.content || "").length;
    overhead += 12;
  }

  return Math.max(0, Math.ceil(chars / 4) + overhead);
}



function renderContextIndicator(info) {
  const angle = contextIndicatorAngle(info);
  return '<button class="contextIndicator" type="button" data-action="context-info" style="--contextAngle: ' + angle + 'deg;" title="' + escapeAttr(info.tooltip + "\nClick for chat information") + '" aria-label="' + escapeAttr(info.tooltip + "\nOpen chat information") + '"></button>';
}

function contextIndicatorAngle(info) {
  const context = info || {};
  const rawAngle = Math.max(0, Math.min(360, Number(context.percent || 0) * 3.6));
  return Number(context.used || 0) > 0 ? Math.max(5, Math.round(rawAngle * 10) / 10) : 0;
}

function renderWorkspaceSelector() {
  const workspace = activeWorkspaceProfile();
  const label = workspace ? workspaceDisplayName(workspace) : "Workspace [0]";
  const pathLabel = workspace ? workspaceTitle(workspace) : "Codex Max workspace";
  return '<button id="workspaceSelector" class="workspaceSelector" type="button" title="' + escapeAttr(pathLabel) + '" aria-haspopup="listbox" aria-expanded="false"><span>' + escapeHtml(label) + '</span></button>';
}

function renderBoardUsage(info) {
  const loadingTitle = accountRateLimitsLoading ? "Refreshing account limits..." : info.tooltip + "\nClick to refresh";
  const loadingLabel = accountRateLimitsLoading ? "Refreshing account limits" : info.tooltip + "\nRefresh account limits";
  const loadingValue = '<strong class="usageValueLoader" aria-hidden="true"></strong>';
  const fiveHourValue = accountRateLimitsLoading ? loadingValue : '<strong>' + escapeHtml(info.fiveHourLabel) + '</strong>';
  const weeklyValue = accountRateLimitsLoading ? loadingValue : '<strong>' + escapeHtml(info.weeklyLabel) + '</strong>';
  const resetsValue = accountRateLimitsLoading ? loadingValue : '<strong>' + escapeHtml(info.limitResetLabel) + '</strong>';

  if (accountRateLimitsLoading) {
    return `
      <button class="boardUsage loading ${escapeAttr(info.statusClass)}" type="button" title="${escapeAttr(loadingTitle)}" aria-label="${escapeAttr(loadingLabel)}">
        <span class="usageDot" aria-hidden="true"></span>
        <span>5h ${fiveHourValue}</span>
        <span>Week ${weeklyValue}</span>
        <span>Status <strong>${escapeHtml(info.statusDisplayLabel)}</strong></span>
        <span>Resets ${resetsValue}</span>
      </button>
    `;
  }

  return `
    <button class="boardUsage ${escapeAttr(info.statusClass)}" type="button" title="${escapeAttr(loadingTitle)}" aria-label="${escapeAttr(loadingLabel)}">
      <span class="usageDot" aria-hidden="true"></span>
      <span>5h ${fiveHourValue}</span>
      <span>Week ${weeklyValue}</span>
      <span>Status <strong>${escapeHtml(info.statusDisplayLabel)}</strong></span>
      <span>Resets ${resetsValue}</span>
    </button>
  `;
}

function boardUsageInfo(chats, accountRateLimits) {
  const items = Array.isArray(chats) ? chats : [];
  let used = 0;
  let limit = 0;
  let running = 0;
  let errors = 0;
  let opened = 0;
  const accountUsage = accountUsageInfo(accountRateLimits);
  const resetCredits = extractLimitResetCredits(accountRateLimits);

  for (const chat of items) {
    const settings = normalizeSettings(chat && chat.settings);
    const context = contextUsageInfo(chat, settings.model);
    used += context.used;
    limit += context.limit;
    if (chat.status === "running") {
      running += 1;
    } else if (chat.status === "error") {
      errors += 1;
    } else if (chat.status === "opened") {
      opened += 1;
    }
  }

  const percent = limit ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : 0;
  const statusClass = running ? "running" : errors ? "error" : opened ? "opened" : "idle";
  const statusLabelText = running ? "Running" : errors ? "Error" : opened ? "Open" : "Idle";
  const statusDisplayLabel = running ? statusLabelText + " " + running : statusLabelText;
  const fiveHourLabel = accountUsage ? accountUsage.fiveHourLabel : percent + "%";
  const weeklyLabel = accountUsage ? accountUsage.weeklyLabel : "n/a";
  const limitResetLabel = resetCredits;
  const tooltip = [
    "Board usage/status",
    accountUsage ? accountUsage.tooltip : "Usage: " + percent + "% (" + formatTokenCount(used) + " / " + formatTokenCount(limit || 0) + " tokens)",
    "Status: " + statusLabelText + " (" + running + " running, " + errors + " error, " + opened + " open)",
    "Available manual limit resets: " + resetCredits
  ].join("\n");

  return {
    used,
    limit,
    percent,
    fiveHourLabel,
    weeklyLabel,
    statusClass,
    statusLabel: statusLabelText,
    statusDisplayLabel,
    runningChats: running,
    limitResetLabel,
    tooltip
  };
}

function accountUsageInfo(value) {
  const limits = extractAccountLimits(value);
  if (!limits.length) {
    return null;
  }

  const fiveHour = limits.find((item) => item.kind === "5h") || limits[0];
  const weekly = limits.find((item) => item.kind === "weekly") || limits.find((item) => item !== fiveHour) || null;
  const tooltip = ["Account usage:"];

  for (const item of [fiveHour, weekly].filter(Boolean)) {
    const label = item.kind === "weekly" ? "Week" : item.kind === "5h" ? "5h" : item.label;
    tooltip.push(label + ": " + item.remainingPercent + "% remaining" + (item.resetLabel ? ", auto reset " + item.resetLabel : ""));
  }

  return {
    fiveHourLabel: fiveHour ? fiveHour.remainingPercent + "%" : "n/a",
    weeklyLabel: weekly ? weekly.remainingPercent + "%" : "n/a",
    tooltip: tooltip.join("\n")
  };
}

function extractLimitResetCredits(value) {
  if (!value || typeof value !== "object") {
    return "n/a";
  }

  const candidates = [];
  const queue = [{ value, path: [] }];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    const item = current.value;
    if (!item || typeof item !== "object" || seen.has(item)) {
      continue;
    }
    seen.add(item);

    for (const key of Object.keys(item)) {
      const child = item[key];
      const pathText = current.path.concat(key).join(" ");
      const normalizedPath = normalizeLimitKey(pathText);
      const looksLikeManualReset =
        /reset/i.test(pathText) &&
        /(available|remaining|left|count|credits|requests|manual)/i.test(pathText);

      if (looksLikeManualReset && Number.isFinite(Number(child))) {
        candidates.push({
          score: manualResetScore(normalizedPath),
          value: Number(child)
        });
      }

      if (typeof child === "string") {
        const match = child.match(/(?:available|remaining|left)\D*(\d+)\D*(?:reset|resets)/i)
          || child.match(/(?:reset|resets)\D*(\d+)/i);
        if (match) {
          candidates.push({
            score: manualResetScore(normalizedPath) + 1,
            value: Number(match[1])
          });
        }
      }

      if (child && typeof child === "object") {
        queue.push({ value: child, path: current.path.concat(key) });
      }
    }
  }

  if (!candidates.length) {
    return "n/a";
  }

  const useful = candidates.filter((item) => item.score > 0);
  if (!useful.length) {
    return "n/a";
  }

  useful.sort((a, b) => b.score - a.score);
  return String(useful[0].value);
}

function manualResetScore(normalizedPath) {
  let score = 0;
  if (/manual|credit|request|available|remaining/.test(normalizedPath)) {
    score += 4;
  }
  if (/limit/.test(normalizedPath)) {
    score += 2;
  }
  if (/reset/.test(normalizedPath)) {
    score += 2;
  }
  if (/resetat|resetsat|resetafter|renew|refresh|time|timestamp/.test(normalizedPath)) {
    score -= 8;
  }
  return score;
}

function extractAccountLimits(value) {
  if (!value || typeof value !== "object") {
    return [];
  }

  const candidates = [];
  const queue = [{ value, path: [] }];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    const item = current.value;
    if (!item || typeof item !== "object" || seen.has(item)) {
      continue;
    }
    seen.add(item);

    for (const key of Object.keys(item)) {
      const child = item[key];
      if (child && typeof child === "object") {
        queue.push({ value: child, path: current.path.concat(key) });
      }
    }

    const limit = parseLimitNode(item, current.path);
    if (limit) {
      candidates.push(limit);
    }
  }

  const unique = [];
  const seenKeys = new Set();
  for (const item of candidates) {
    const key = item.kind + ":" + item.remainingPercent + ":" + item.resetLabel;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      unique.push(item);
    }
  }

  return unique.sort((a, b) => {
    const order = { "5h": 0, weekly: 1, other: 2 };
    return (order[a.kind] || 2) - (order[b.kind] || 2);
  });
}

function parseLimitNode(item, pathParts) {
  const entries = Object.keys(item).map((key) => ({
    key,
    normalized: normalizeLimitKey(key),
    value: item[key]
  }));
  const remaining = findRemainingPercent(entries);
  if (remaining === null) {
    return null;
  }

  const resetLabel = findResetLabel(entries);
  const labelText = pathParts.concat(entries.map((entry) => {
    return typeof entry.value === "string" ? entry.value : "";
  })).join(" ").toLowerCase();
  const kind = classifyLimitWindow(entries, labelText);

  return {
    kind,
    label: kind === "other" ? "Limit" : kind,
    remainingPercent: remaining,
    resetLabel
  };
}

function findRemainingPercent(entries) {
  const direct = findNumericEntry(entries, /(remaining|available|left).*(percent|pct)|(percent|pct).*(remaining|available|left)/);
  if (direct !== null) {
    return normalizePercentEntry(direct);
  }

  const used = findNumericEntry(entries, /(used|usage|consumed).*(percent|pct)|(percent|pct).*(used|usage|consumed)/);
  if (used !== null) {
    return Math.max(0, Math.min(100, 100 - normalizePercentEntry(used)));
  }

  return null;
}

function findNumericEntry(entries, pattern) {
  for (const entry of entries) {
    if (pattern.test(entry.normalized) && Number.isFinite(Number(entry.value))) {
      return entry;
    }
  }
  return null;
}

function normalizePercentEntry(entry) {
  const number = Number(entry && entry.value);
  const key = String(entry && entry.normalized || "");
  const percent = number > 0 && number < 1
    ? number * 100
    : number;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function findResetLabel(entries) {
  for (const entry of entries) {
    if (!/reset|renew|refresh/.test(entry.normalized)) {
      continue;
    }

    const value = entry.value;
    if (typeof value === "string" && value.trim()) {
      return formatResetValue(value.trim());
    }
    if (Number.isFinite(Number(value))) {
      return formatResetValue(Number(value));
    }
  }
  return "";
}

function formatResetValue(value) {
  if (typeof value === "number") {
    if (value > 100000000000) {
      return formatDateTime(value);
    }
    if (value > 1000000000) {
      return formatDateTime(value * 1000);
    }
    if (value >= 0 && value < 60 * 60 * 24 * 14) {
      return formatDuration(value * 1000);
    }
    return String(value);
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return formatDateTime(date.getTime());
  }
  return value;
}

function classifyLimitWindow(entries, labelText) {
  const text = labelText + " " + entries.map((entry) => entry.normalized + " " + entry.value).join(" ");
  if (/week|weekly|7d|seven|10080|secondary|long/.test(text)) {
    return "weekly";
  }
  if (/5h|5hr|5hour|fivehour|five|300|primary|short|rolling/.test(text)) {
    return "5h";
  }
  return "other";
}

function normalizeLimitKey(value) {
  return String(value || "").replace(/[_\-\s]/g, "").toLowerCase();
}

function contextUsageInfo(chat, model) {
  const limit = contextWindowForModel(model);
  const used = estimateChatTokens(chat);
  const percent = limit ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
  const displayPercent = Math.round(percent);
  const tooltip = [
    "Context window:",
    displayPercent + "% full",
    formatExactTokenCount(used) + " / " + formatExactTokenCount(limit) + " tokens used"
  ].join("\n");

  return {
    used,
    limit,
    percent,
    tooltip
  };
}

function contextWindowForModel(model) {
  const normalized = normalizeModelId(model);
  if (/^gpt-5\./.test(normalized)) {
    return 258000;
  }
  if (normalized === "o3") {
    return 200000;
  }
  if (normalized === "o4-mini") {
    return 128000;
  }

  return 128000;
}

function estimateChatTokens(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  let chars = 0;
  let overhead = messages.length * 8;

  for (const message of messages) {
    chars += String(message.text || "").length;
    chars += String(message.title || "").length;
    chars += String(message.detail || "").length;
    overhead += 4;
  }

  for (const attachment of attachments) {
    chars += String(attachment.name || "").length;
    chars += String(attachment.path || "").length;
    chars += String(attachment.content || "").length;
    overhead += 12;
  }

  return Math.max(0, Math.ceil(chars / 4) + overhead);
}

function formatTokenCount(value) {
  const tokens = Number(value || 0);
  if (tokens >= 1000000) {
    return Math.round(tokens / 100000) / 10 + "m";
  }
  if (tokens >= 1000) {
    return Math.round(tokens / 100) / 10 + "k";
  }
  return String(tokens);
}

function formatExactTokenCount(value) {
  const tokens = Math.max(0, Math.round(Number(value || 0)));
  return tokens.toLocaleString("en-US");
}
