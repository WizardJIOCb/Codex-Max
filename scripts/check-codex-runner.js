const assert = require("assert");
const { buildCodexArgs } = require("../lib/codex-runner");

const settings = {
  model: "gpt-5.5",
  reasoning: "medium",
  verbosity: "high",
  webSearch: "cached",
  sandbox: "workspace-write"
};

const fresh = buildCodexArgs({
  sessionId: "",
  settings,
  cwd: "C:\\Projects\\codex.max"
});

assert.deepStrictEqual(fresh.slice(0, 5), ["exec", "--json", "--skip-git-repo-check", "--cd", "C:\\Projects\\codex.max"]);
assert(fresh.includes("--model"));
assert(fresh.includes("gpt-5.5"));
assert(fresh.includes("--sandbox"));
assert(fresh.includes("workspace-write"));
assert(fresh.includes('model_reasoning_effort="medium"'));
assert(fresh.includes('model_verbosity="high"'));
assert(fresh.includes('web_search="cached"'));
assert.strictEqual(fresh[fresh.length - 1], "-");

const resumed = buildCodexArgs({
  sessionId: "thread-123",
  settings,
  cwd: "C:\\Projects\\codex.max"
});

assert.deepStrictEqual(resumed.slice(0, 4), ["exec", "resume", "--json", "--skip-git-repo-check"]);
assert(resumed.includes("thread-123"));
assert(resumed.includes('sandbox_mode="workspace-write"'));
assert.strictEqual(resumed[resumed.length - 1], "-");

console.log("Codex runner args smoke-check passed.");
