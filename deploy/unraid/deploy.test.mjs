import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./deploy.sh", import.meta.url));
const bash =
  process.env.BASH ||
  (process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash");
const sourceSha = "a".repeat(40);
const frontendId = `sha256:${"b".repeat(64)}`;
const serverId = `sha256:${"c".repeat(64)}`;
const previousEnv = [
  "UNRAID_APPDATA_ROOT=/mnt/user/appdata/sparky-deploy-script-test",
  `SPARKY_FITNESS_FRONTEND_IMAGE=ghcr.io/test/frontend@sha256:${"d".repeat(64)}`,
  `SPARKY_FITNESS_SERVER_IMAGE=ghcr.io/test/server@sha256:${"e".repeat(64)}`,
  `SPARKY_FITNESS_SOURCE_SHA=${"f".repeat(40)}`,
  "",
].join("\n");
const portable = (path) => path.replaceAll("\\", "/");

const dockerStub = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$DEPLOY_TEST_LOG"
if [[ "$1" == image && "$2" == inspect ]]; then
  for image in "$@"; do :; done
  [[ "$image" != "$DEPLOY_TEST_MISSING_IMAGE" ]] || exit 1
  revision="$DEPLOY_TEST_SOURCE_SHA"
  if [[ "$image" == "$DEPLOY_TEST_OTHER_REVISION_IMAGE" ]]; then
    revision=ffffffffffffffffffffffffffffffffffffffff
  fi
  if [[ "$image" == "$DEPLOY_TEST_OMIT_REVISION_IMAGE" ]]; then
    revision='<no value>'
  fi
  if [[ "$image" == "$DEPLOY_TEST_DIFFERENT_ID_IMAGE" ]]; then
    image=sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
  fi
  printf '%s %s\n' "$image" "$revision"
  exit 0
fi
[[ "$1" == compose ]] || exit 2
shift
if [[ "$1" == version ]]; then exit 0; fi
if [[ "$1" == up && "$2" == --help ]]; then printf '%s\n' --wait; exit 0; fi
env_file=''
while [[ "$1" == --project-name || "$1" == --env-file || "$1" == -f ]]; do
  if [[ "$1" == --env-file ]]; then env_file="$2"; fi
  shift 2
done
case "$1" in
  ps|logs) exit 0 ;;
  pull) exit 0 ;;
  up)
    frontend=$(awk -F= '$1 == "SPARKY_FITNESS_FRONTEND_IMAGE" { print $2 }' "$env_file")
    server=$(awk -F= '$1 == "SPARKY_FITNESS_SERVER_IMAGE" { print $2 }' "$env_file")
    printf 'images %s %s\n' "$frontend" "$server" >> "$DEPLOY_TEST_LOG"
    if [[ "$DEPLOY_TEST_FAIL_FIRST_UP" == 1 && ! -f "$DEPLOY_TEST_LOG.up-once" ]]; then
      : > "$DEPLOY_TEST_LOG.up-once"
      exit 1
    fi
    exit 0
    ;;
  *) exit 2 ;;
esac
`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "sparky-deploy-test-"));
  t.after(() => {
    // Only remove the exact temporary fixture created above, including on Windows.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("sparky-deploy-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(root, "deploy.sh"),
    readFileSync(script, "utf8").replaceAll("\r\n", "\n"),
  );
  writeFileSync(join(root, "compose.yml"), "services: {}\n");
  writeFileSync(join(root, ".env"), previousEnv);
  writeFileSync(join(bin, "docker"), dockerStub, { mode: 0o700 });
  writeFileSync(join(bin, "id"), '#!/usr/bin/env bash\nprintf "0\\n"\n', {
    mode: 0o700,
  });
  for (const command of ["flock", "mkdir", "chmod"]) {
    // Appdata operations are recorded, never performed against a real host path.
    writeFileSync(
      join(bin, command),
      `#!/usr/bin/env bash\nprintf '${command} %s\\n' "$*" >> "$DEPLOY_TEST_LOG"\n`,
      { mode: 0o700 },
    );
  }
  const log = join(root, "commands.log");
  return {
    root,
    commands: () =>
      existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
    run: (args, overrides = {}) =>
      spawnSync(
        bash,
        [
          "--noprofile",
          "--norc",
          "-c",
          'test_bin="$(cd -- "$DEPLOY_TEST_BIN" && pwd)"; export PATH="$test_bin:$PATH"; exec bash "$@"',
          "deploy-script-test",
          portable(join(root, "deploy.sh")),
          ...args,
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 20_000,
          env: {
            ...process.env,
            DEPLOY_TEST_BIN: portable(bin),
            DEPLOY_TEST_LOG: portable(log),
            DEPLOY_TEST_SOURCE_SHA: sourceSha,
            DEPLOY_TEST_MISSING_IMAGE: "",
            DEPLOY_TEST_OTHER_REVISION_IMAGE: "",
            DEPLOY_TEST_OMIT_REVISION_IMAGE: "",
            DEPLOY_TEST_DIFFERENT_ID_IMAGE: "",
            DEPLOY_TEST_FAIL_FIRST_UP: "0",
            ...overrides,
          },
        },
      ),
  };
}

function assertRejectedBeforeChanges(context, result, expectedError) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, expectedError);
  assert.equal(readFileSync(join(context.root, ".env"), "utf8"), previousEnv);
  assert.equal(existsSync(join(context.root, ".env.previous")), false);
  assert.equal(
    existsSync(join(context.root, ".last-successful-deploy")),
    false,
  );
  assert.equal(
    context
      .commands()
      .some((line) =>
        /^(mkdir|chmod) | compose .* (up|pull|exec|ps) /.test(line),
      ),
    false,
  );
}

test("deployment script has valid Bash syntax", () => {
  const result = spawnSync(bash, ["-n", portable(script)], {
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, frontend, server, sha] of [
  ["frontend mutable tag", "sparky-frontend:latest", serverId, sourceSha],
  ["server mutable tag", frontendId, "sparky-server:latest", sourceSha],
  ["short image ID", `sha256:${"b".repeat(63)}`, serverId, sourceSha],
  ["uppercase image ID", `sha256:${"B".repeat(64)}`, serverId, sourceSha],
  [
    "registry digest in local mode",
    `ghcr.io/test/frontend@${frontendId}`,
    serverId,
    sourceSha,
  ],
  ["short commit SHA", frontendId, serverId, sourceSha.slice(1)],
]) {
  test(`local mode rejects ${name} before any changes`, (t) => {
    const context = fixture(t);
    assertRejectedBeforeChanges(
      context,
      context.run(["--local", frontend, server, sha]),
      /ERROR: (local (frontend|server) image must be|source SHA must be)/,
    );
  });
}

for (const [name, key, image] of [
  ["missing frontend", "DEPLOY_TEST_MISSING_IMAGE", frontendId],
  ["missing server", "DEPLOY_TEST_MISSING_IMAGE", serverId],
  [
    "frontend from another commit",
    "DEPLOY_TEST_OTHER_REVISION_IMAGE",
    frontendId,
  ],
  ["server from another commit", "DEPLOY_TEST_OTHER_REVISION_IMAGE", serverId],
  ["missing revision label", "DEPLOY_TEST_OMIT_REVISION_IMAGE", serverId],
  [
    "a different inspected image ID",
    "DEPLOY_TEST_DIFFERENT_ID_IMAGE",
    frontendId,
  ],
]) {
  test(`local mode rejects ${name} before backup or environment changes`, (t) => {
    const context = fixture(t);
    assertRejectedBeforeChanges(
      context,
      context.run(["--local", frontendId, serverId, sourceSha], {
        [key]: image,
      }),
      /ERROR: local (frontend|server) image (is not available|ID and)/,
    );
  });
}

test("local mode starts exact verified IDs, never pulls, and records success", (t) => {
  const context = fixture(t);
  const result = context.run(["--local", frontendId, serverId, sourceSha]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const commands = context.commands();
  assert.equal(
    commands.filter((line) => line.startsWith("docker image inspect ")).length,
    2,
  );
  assert.equal(
    commands.some((line) => line.includes(" pull ")),
    false,
  );
  assert.ok(
    commands.some((line) =>
      line.includes(
        " up --detach --remove-orphans --wait --wait-timeout 240 --pull never",
      ),
    ),
  );
  assert.ok(commands.includes(`images ${frontendId} ${serverId}`));
  assert.equal(
    readFileSync(join(context.root, ".env.previous"), "utf8"),
    previousEnv,
  );
  assert.equal(
    readFileSync(join(context.root, ".last-successful-deploy"), "utf8"),
    `${sourceSha}\n`,
  );
});

test("a failed local start restores the previous environment without registry access", (t) => {
  const context = fixture(t);
  const result = context.run(["--local", frontendId, serverId, sourceSha], {
    DEPLOY_TEST_FAIL_FIRST_UP: "1",
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(readFileSync(join(context.root, ".env"), "utf8"), previousEnv);
  assert.equal(
    existsSync(join(context.root, ".last-successful-deploy")),
    false,
  );
  const starts = context
    .commands()
    .filter((line) => line.includes(" up --detach "));
  assert.equal(starts.length, 2);
  assert.ok(starts.every((line) => line.includes("--pull never")));
  assert.equal(
    context.commands().some((line) => line.includes(" pull ")),
    false,
  );
  assert.match(result.stderr, /Application rollback completed/);
});

test("the existing three-argument GHCR digest deployment still pulls and starts normally", (t) => {
  const context = fixture(t);
  const frontend = `ghcr.io/test/frontend@${frontendId}`;
  const server = `ghcr.io/test/server@${serverId}`;
  const result = context.run([frontend, server, sourceSha]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    context.commands().some((line) => line.startsWith("docker image inspect ")),
    false,
  );
  assert.ok(
    context
      .commands()
      .some((line) =>
        line.includes(" pull sparkyfitness-server sparkyfitness-frontend"),
      ),
  );
  assert.ok(context.commands().includes(`images ${frontend} ${server}`));
  assert.equal(
    context.commands().some((line) => line.includes("--pull never")),
    false,
  );
});

test("local image IDs remain rejected without the explicit local flag", (t) => {
  const context = fixture(t);
  assertRejectedBeforeChanges(
    context,
    context.run([frontendId, serverId, sourceSha]),
    /ERROR: frontend image must be an immutable ghcr\.io digest/,
  );
});
