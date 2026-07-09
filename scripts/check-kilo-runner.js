const assert = require("assert");
const { buildKiloArgs, isKiloSessionId } = require("../lib/kilo-runner");

const args = buildKiloArgs({
  sessionId: "ses_0b9d5e248ffeIJ2rEToRaoiyHK",
  settings: { model: "kilo/kilo-auto/free", reasoning: "high" },
  prompt: "Explain this repo",
  cwd: "C:\\Projects\\doom dark ages"
});

assert.deepStrictEqual(args.slice(0, 6), ["run", "--format", "json", "--auto", "--dir", "C:\\Projects\\doom dark ages"]);
assert.deepStrictEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "kilo/kilo-auto/free"]);
assert.deepStrictEqual(args.slice(args.indexOf("--variant"), args.indexOf("--variant") + 2), ["--variant", "high"]);
assert.deepStrictEqual(args.slice(args.indexOf("--session"), args.indexOf("--session") + 2), ["--session", "ses_0b9d5e248ffeIJ2rEToRaoiyHK"]);
assert.strictEqual(args.at(-1), "Explain this repo");
assert.strictEqual(isKiloSessionId("ses_0b9d5e248ffeIJ2rEToRaoiyHK"), true);
assert.strictEqual(isKiloSessionId("grok-chat-123"), false);

const fallbackModelArgs = buildKiloArgs({
  sessionId: "",
  settings: { model: "gpt-5.5" },
  prompt: "Hello",
  cwd: "C:\\Projects\\codex.max"
});

assert.deepStrictEqual(fallbackModelArgs.slice(fallbackModelArgs.indexOf("--model"), fallbackModelArgs.indexOf("--model") + 2), ["--model", "kilo/kilo-auto/free"]);
console.log("Kilo runner args smoke-check passed.");
