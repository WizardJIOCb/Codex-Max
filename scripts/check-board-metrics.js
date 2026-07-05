const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "webview", "board-metrics.js"), "utf8");
const context = {
  console,
  escapeHtml: (value) => String(value),
  escapeAttr: (value) => String(value),
  formatDateTime: (value) => String(value),
  formatDuration: (value) => String(value),
  normalizeSettings: (value) => value || {},
  normalizeModelId: (value) => String(value || "")
};

vm.createContext(context);
vm.runInContext(source, context);

const usage = context.accountUsageInfo({
  rateLimits: {
    primary: {
      usedPercent: 1,
      windowDurationMins: 300,
      resetsAt: 1783312244
    },
    secondary: {
      usedPercent: 52,
      windowDurationMins: 10080,
      resetsAt: 1783801112
    }
  }
});

assert(usage, "Expected account usage to be parsed");
assert.strictEqual(usage.fiveHourLabel, "99%");
assert.strictEqual(usage.weeklyLabel, "48%");

const fractional = context.accountUsageInfo({
  rateLimits: {
    primary: {
      remainingPercent: 0.99,
      windowDurationMins: 300
    },
    secondary: {
      remainingPercent: 0.48,
      windowDurationMins: 10080
    }
  }
});

assert(fractional, "Expected fractional account usage to be parsed");
assert.strictEqual(fractional.fiveHourLabel, "99%");
assert.strictEqual(fractional.weeklyLabel, "48%");

console.log("Board metrics smoke-check passed.");
