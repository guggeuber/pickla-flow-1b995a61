#!/usr/bin/env node
// Persist the local append-only record on a dedicated bot-owned ref. A normal
// fast-forward push is the compare-and-swap; no force push or history rewrite.
import { execFileSync } from "node:child_process";
import { mkdtempSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const branch = "pickla-release-registry";
const root = new URL("../", import.meta.url).pathname;
const local = process.env.PICKLA_RELEASE_REGISTRY || join(root, ".pickla-release-v1");
const work = mkdtempSync(join(tmpdir(), "pickla-registry-"));
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const originUrl = git(["remote", "get-url", "origin"]);
try {
  for (let attempt = 0; attempt < 5; attempt++) {
    const remote = git(["ls-remote", "origin", `refs/heads/${branch}`]).split("\t")[0];
    if (remote) {
      if (!existsSync(join(work, ".git"))) git(["clone", "--no-checkout", "--shared", root, work]);
      git(["remote", "set-url", "origin", originUrl], work);
      git(["fetch", "origin", `refs/heads/${branch}`], work);
      git(["checkout", "-B", branch, "FETCH_HEAD"], work);
    } else {
      if (!existsSync(join(work, ".git"))) git(["clone", "--no-checkout", "--shared", root, work]);
      git(["remote", "set-url", "origin", originUrl], work);
      git(["checkout", "--orphan", branch], work);
      for (const name of readdirSync(work)) if (name !== ".git") rmSync(join(work, name), { recursive: true, force: true });
    }
    mkdirSync(join(work, "records"), { recursive: true });
    for (const name of readdirSync(local).filter((value) => value.endsWith(".json"))) {
      let source = JSON.parse(readFileSync(join(local, name)));
      const target = join(work, "records", name);
      if (existsSync(target)) {
        const previous = JSON.parse(readFileSync(target));
        if (previous.candidate_sha !== source.candidate_sha) throw new Error("registry candidate collision");
        const oldKeys = new Set(previous.events.map((value) => `${value.event}:${value.key}`));
        if (previous.updated_at > source.updated_at) {
          if (source.events.some((value) => !oldKeys.has(`${value.event}:${value.key}`))) throw new Error("stale local register with unsynced events; reload and retry");
          source = previous;
        }
        source.events = [...previous.events, ...source.events.filter((value) => !oldKeys.has(`${value.event}:${value.key}`))];
      }
      writeFileSync(target, JSON.stringify(source, null, 2) + "\n");
    }
    git(["add", "records"], work);
    if (!git(["status", "--porcelain"], work)) process.exit(0);
    git(["-c", "user.name=pickla-release-bot", "-c", "user.email=release-bot@users.noreply.github.com", "commit", "-m", "Update Pickla release register"], work);
    try { git(["push", "origin", `HEAD:refs/heads/${branch}`], work); process.exit(0); }
    catch { if (attempt === 4) throw new Error("registry concurrent update did not converge"); }
  }
} finally { rmSync(work, { recursive: true, force: true }); }
