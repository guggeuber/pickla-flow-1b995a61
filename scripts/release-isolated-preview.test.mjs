import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
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
