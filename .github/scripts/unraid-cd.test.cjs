const assert = require("node:assert/strict");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = resolve(__dirname, "../..");
const workflow = readFileSync(
  join(root, ".github/workflows/unraid-cd.yml"),
  "utf8",
);
const revisionStep = workflow
  .split("      - name: Check automatic deployment revision\n")[1]
  ?.split("\n      - name:")[0];
assert.ok(revisionStep, "the deployment must verify the live main revision");
const script = revisionStep
  .split("        run: |\n")[1]
  .split("\n")
  .map((line) => line.replace(/^          /, ""))
  .join("\n");
const current = "a".repeat(40);
const previous = "b".repeat(40);
const bash =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

function check(event, source, main = current) {
  const privateRoot = join(root, "private");
  mkdirSync(privateRoot, { recursive: true });
  const directory = mkdtempSync(join(privateRoot, "cd-policy-"));
  assert.ok(
    resolve(directory).startsWith(
      `${resolve(privateRoot)}${require("node:path").sep}`,
    ),
  );
  const output = join(directory, "output");
  const summary = join(directory, "summary");
  const shellPath = (path) =>
    path
      .replaceAll("\\", "/")
      .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
  try {
    writeFileSync(
      join(directory, "git"),
      '#!/usr/bin/env bash\nprintf "%s\\trefs/heads/main\\n" "$TEST_MAIN"\n',
      { mode: 0o755 },
    );
    const result = spawnSync(
      bash,
      ["-c", `export PATH="${shellPath(directory)}:$PATH"\n${script}`],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          SOURCE_SHA: source,
          TEST_MAIN: main,
          GITHUB_EVENT_NAME: event,
          GITHUB_OUTPUT: shellPath(output),
          GITHUB_STEP_SUMMARY: shellPath(summary),
        },
      },
    );
    return {
      status: result.status,
      error: result.error,
      stderr: result.stderr,
      output: existsSync(output) ? readFileSync(output, "utf8") : "",
      summary: existsSync(summary) ? readFileSync(summary, "utf8") : "",
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a late CI result cannot automatically replace the current production revision", () => {
  const result = check("workflow_run", previous);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /proceed=false/);
  assert.match(result.summary, /Skipped superseded automatic deployment/);
});

test("the current successfully tested main revision may deploy automatically", () => {
  const result = check("workflow_run", current);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /proceed=true/);
});

test("an explicit manual rollback remains available", () => {
  const result = check("workflow_dispatch", previous);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /proceed=true/);
});

test("an unverifiable main revision fails before a server connection", () => {
  const result = check("workflow_run", current, "");
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not verify the current main revision/);
  assert.equal(result.output, "");
});

test("every remote mutation and success summary requires the revision check", () => {
  for (const name of [
    "Connect ephemeral runner to the Tailnet",
    "Synchronize deployment files",
    "Deploy immutable images",
    "Deployment summary",
  ]) {
    const step = workflow
      .split(`      - name: ${name}\n`)[1]
      ?.split("\n      - name:")[0];
    assert.match(step ?? "", /if: steps\.revision\.outputs\.proceed == 'true'/);
  }
});
