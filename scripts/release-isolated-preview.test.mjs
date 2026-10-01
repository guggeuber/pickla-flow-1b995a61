import test from "node:test";
import assert from "node:assert/strict";
import { parseServedRelease, selectExactPreview } from "./release-isolated-preview.mjs";

const target = {
  preview_git_branch: "codex/release-v1-20261001",
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
});

test("served release requires no-store, age zero, and valid response", () => {
  const body = { sha };
  assert.deepEqual(parseServedRelease(`HTTP/2 200\r\nage: 0\r\ncache-control: private, no-store\r\n\r\n${JSON.stringify(body)}`), body);
  assert.throws(() => parseServedRelease(`HTTP/2 200\r\nage: 1\r\ncache-control: private, no-store\r\n\r\n${JSON.stringify(body)}`), /stale/);
  assert.throws(() => parseServedRelease(`HTTP/2 200\r\nage: 0\r\ncache-control: max-age=60\r\n\r\n${JSON.stringify(body)}`), /cacheable/);
});
