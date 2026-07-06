const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildCodexArgs, createGroupedLogBuffer } = require("../lib/codex-runner");
const { spawnExternalProcess } = require("../lib/platform");

async function main() {
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

  if (process.platform === "win32") {
    await assertWindowsCmdKeepsSpacedArgs();
  }
  assertGroupedLogBuffer();

  console.log("Codex runner args smoke-check passed.");
}

function assertGroupedLogBuffer() {
  const flushed = [];
  const buffer = createGroupedLogBuffer((detail) => flushed.push(detail), 10000);
  buffer.push("ERROR first line");
  buffer.push("Output:");
  buffer.push("The string is missing the terminator: \".");
  buffer.flush();
  assert.deepStrictEqual(flushed, [
    "ERROR first line\nOutput:\nThe string is missing the terminator: \"."
  ]);
}

function assertWindowsCmdKeepsSpacedArgs() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-max-args-"));
  const dumper = path.join(tempDir, "dump-args.js");
  const command = path.join(tempDir, "dump-args.cmd");
  fs.writeFileSync(dumper, "console.log(JSON.stringify(process.argv.slice(2)));", "utf8");
  fs.writeFileSync(command, `@node "${dumper}" %*\r\n`, "ascii");

  return new Promise((resolve, reject) => {
    const child = spawnExternalProcess(command, [
      "--cd",
      "C:\\Projects\\doom dark ages",
      "-c",
      'model_reasoning_effort="medium"',
      "-"
    ], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        assert.strictEqual(code, 0, stderr);
        const parsed = JSON.parse(stdout.trim());
        assert.deepStrictEqual(parsed, [
          "--cd",
          "C:\\Projects\\doom dark ages",
          "-c",
          'model_reasoning_effort="medium"',
          "-"
        ]);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
