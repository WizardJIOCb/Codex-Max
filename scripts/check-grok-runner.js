const assert = require("assert");
const { buildGrokArgs, isGrokSessionId } = require("../lib/grok-runner");

const args = buildGrokArgs({
  sessionId: "grok-chat-123",
  settings: { model: "grok-4.5" },
  prompt: "Explain this repo",
  cwd: "C:\\Projects\\doom dark ages"
});

assert(args.includes("--no-auto-update"));
assert(args.includes("--no-alt-screen"));
assert(args.includes("--always-approve"));
assert.deepStrictEqual(args.slice(args.indexOf("--cwd"), args.indexOf("--cwd") + 2), ["--cwd", "C:\\Projects\\doom dark ages"]);
assert.deepStrictEqual(args.slice(args.indexOf("-m"), args.indexOf("-m") + 2), ["-m", "grok-4.5"]);
assert.deepStrictEqual(args.slice(args.indexOf("--session-id"), args.indexOf("--session-id") + 2), ["--session-id", "grok-chat-123"]);
assert.deepStrictEqual(args.slice(-2), ["-p", "Explain this repo"]);
assert.strictEqual(isGrokSessionId("grok-chat-123"), true);
assert.strictEqual(isGrokSessionId("019f33d5-9e48-7c00-8616-4508c0db4784"), false);

const fallbackModelArgs = buildGrokArgs({
  sessionId: "",
  settings: { model: "gpt-5.5" },
  prompt: "Hello",
  cwd: "C:\\Projects\\codex.max"
});

assert.deepStrictEqual(fallbackModelArgs.slice(fallbackModelArgs.indexOf("-m"), fallbackModelArgs.indexOf("-m") + 2), ["-m", "grok-build"]);
console.log("Grok runner args smoke-check passed.");
