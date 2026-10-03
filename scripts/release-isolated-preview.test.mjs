import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { exactPreviewRequest, parseServedRelease, selectExactPreview } from "./release-isolated-preview.mjs";

const target = {
  preview_git_branch: "codex/release-v1-20261001",
  vercel_project_id: "prj_ZXHb62NWhYVlIrj2yaEZekIxgJVV",
  preview_domain_suffix: ".vercel.app",
  preview_env_verified_after: "2026-10-01T15:35:00Z",
  forbidden_domains: ["playpickla.com", "www.playpickla.com", "stage.playpickla.com"],
};
const sha = "a".repeat(40);
const preview = { state: "READY", url: "pickla-flow-abc.vercel.app", createdAt: Date.parse("2026-10-01T16:00:00Z"), meta: { githubCommitSha: sha, githubCommitRef: target.preview_git_branch } };

test("selects only the exact post-configuration preview and rejects unsafe routes", () => {
  assert.equal(selectExactPreview([preview], target, sha).url, preview.url);
  assert.throws(() => selectExactPreview([{ ...preview, createdAt: Date.parse("2026-10-01T14:00:00Z") }], target, sha), /count 0/);
  assert.throws(() => selectExactPreview([{ ...preview, meta: { ...preview.meta, githubCommitSha: "b".repeat(40) } }], target, sha), /count 0/);
  assert.throws(() => selectExactPreview([{ ...preview, url: "stage.playpickla.com" }], target, sha), /protected domain/);
  assert.throws(() => selectExactPreview([preview, preview], target, sha), /count 2/);
  assert.equal(selectExactPreview([{ ...preview, url: "pickla-flow-a.vercel.app" }, { ...preview, url: "pickla-flow-b.vercel.app" }], target, sha, "pickla-flow-b.vercel.app").url, "pickla-flow-b.vercel.app");
});

test("manual SHA-bound deployment cannot request production or shared aliases", () => {
  const request = exactPreviewRequest(target, sha, `rel-${sha.slice(0, 12)}-12345678`);
  assert.equal(request.gitSource.sha, sha);
  assert.equal(request.gitSource.ref, target.preview_git_branch);
  assert.equal(request.project, target.vercel_project_id);
  assert.equal(Object.hasOwn(request, "target"), false);
  assert.equal(Object.hasOwn(request, "alias"), false);
  assert.throws(() => exactPreviewRequest({ ...target, vercel_project_id: "prj_other" }, sha, `rel-${sha.slice(0, 12)}-12345678`), /unapproved/);
});

test("served release requires no-store, age zero, and valid response", () => {
  const body = { sha };
  assert.deepEqual(parseServedRelease(`HTTP/2 200\r\nage: 0\r\ncache-control: private, no-store\r\n\r\n${JSON.stringify(body)}`), body);
  assert.throws(() => parseServedRelease(`HTTP/2 200\r\nage: 1\r\ncache-control: private, no-store\r\n\r\n${JSON.stringify(body)}`), /stale/);
  assert.throws(() => parseServedRelease(`HTTP/2 200\r\nage: 0\r\ncache-control: max-age=60\r\n\r\n${JSON.stringify(body)}`), /cacheable/);
});

test("Vercel CLI failure never puts its token into the release error", () => {
  const directory = mkdtempSync(join(tmpdir(), "pickla-vercel-cli-test-"));
  try {
    const executable = join(directory, "npx");
    writeFileSync(executable, "#!/bin/sh\nexit 4\n");
    chmodSync(executable, 0o755);
    const moduleUrl = new URL("./release-isolated-preview.mjs", import.meta.url).href;
    const code = `import { createExactPreview } from ${JSON.stringify(moduleUrl)}; try { createExactPreview(${JSON.stringify(target)}, ${JSON.stringify(sha)}, ${JSON.stringify(`rel-${sha.slice(0, 12)}-12345678`)}, process.env.STAGE_VERCEL_TOKEN); } catch (error) { console.log(error.message); }`;
    const token = "vercel-token-must-stay-secret";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, STAGE_VERCEL_TOKEN: token },
      cwd: fileURLToPath(new URL("../", import.meta.url)),
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Vercel list operation failed/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(token));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("protected Preview bypass is available only to Vercel curl subprocesses", () => {
  const directory = mkdtempSync(join(tmpdir(), "pickla-vercel-bypass-test-"));
  try {
    const capture = join(directory, "calls.jsonl");
    const executable = join(directory, "npx");
    const url = "pickla-flow-abc.vercel.app";
    const deploymentId = "dpl_SYNTHETIC";
    writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const command = args[2];
fs.appendFileSync(process.env.PICKLA_CAPTURE_PATH, JSON.stringify({ command, bypass: Boolean(process.env.VERCEL_AUTOMATION_BYPASS_SECRET) }) + "\\n");
if (command === "list") console.log(JSON.stringify({ deployments: [{ state: "READY", url: ${JSON.stringify(url)}, createdAt: ${preview.createdAt}, meta: { githubCommitSha: ${JSON.stringify(sha)}, githubCommitRef: ${JSON.stringify(target.preview_git_branch)} } }] }));
else if (command === "inspect") console.log(JSON.stringify({ id: ${JSON.stringify(deploymentId)}, url: ${JSON.stringify(url)}, target: "preview", readyState: "READY" }));
else if (command === "curl") {
  const endpoint = args[3];
  if (endpoint.includes("/api/release")) process.stdout.write("HTTP/2 200\\r\\nage: 0\\r\\ncache-control: private, no-store\\r\\n\\r\\n" + JSON.stringify({ sha: ${JSON.stringify(sha)}, deployment_id: ${JSON.stringify(deploymentId)}, deployment_url: ${JSON.stringify(url)}, environment: "preview", request_id: "release-${sha.slice(0, 16)}" }));
  else if (endpoint.endsWith(".js")) process.stdout.write("https://byuwuoivuuklcwmoesrx.supabase.co");
  else process.stdout.write('<script src="/assets/app.js"></script>');
} else process.exit(5);
`);
    chmodSync(executable, 0o755);
    const moduleUrl = new URL("./release-isolated-preview.mjs", import.meta.url).href;
    const code = `import { discoverExactPreview } from ${JSON.stringify(moduleUrl)}; const result = discoverExactPreview(${JSON.stringify({ ...target, supabase_ref: "byuwuoivuuklcwmoesrx" })}, ${JSON.stringify(sha)}, "synthetic-token", ${JSON.stringify(deploymentId)}); console.log(result.served_sha);`;
    const bypass = "synthetic-bypass";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8", cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, PICKLA_CAPTURE_PATH: capture, VERCEL_AUTOMATION_BYPASS_SECRET: bypass },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), sha);
    const calls = readFileSync(capture, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(calls.some((call) => call.command === "curl"));
    assert.ok(calls.filter((call) => call.command === "curl").every((call) => call.bypass));
    assert.ok(calls.filter((call) => call.command !== "curl").every((call) => !call.bypass));
    assert.ok(!`${result.stdout}${result.stderr}${readFileSync(capture, "utf8")}`.includes(bypass));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
