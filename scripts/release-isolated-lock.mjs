import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// One ref for the one isolated Supabase target. Fast-forward pushes are the CAS;
// a failed or interrupted run leaves the lock held for explicit investigation.
const ref = "refs/heads/pickla-release-isolated-lock";
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export function withIsolatedTargetLock(root, releaseId, action) {
  const origin = git(["remote", "get-url", "origin"], root);
  const work = mkdtempSync(join(tmpdir(), "pickla-isolated-lock-"));
  let acquired = false;
  let completed = false;
  const commit = (status) => {
    writeFileSync(join(work, "lock.json"), `${JSON.stringify({ target: "byuwuoivuuklcwmoesrx", release_id: releaseId, status, at: new Date().toISOString() })}\n`);
    git(["add", "lock.json"], work);
    git(["-c", "user.name=pickla-release-bot", "-c", "user.email=release-bot@users.noreply.github.com", "commit", "-m", `${status} isolated Release V1 target for ${releaseId}`], work);
    git(["push", "origin", `HEAD:${ref}`], work);
  };
  try {
    git(["clone", "--shared", "--no-checkout", "--quiet", root, work]);
    git(["remote", "set-url", "origin", origin], work);
    const remote = git(["ls-remote", "origin", ref], work).split("\t")[0];
    if (remote) {
      git(["fetch", "--quiet", "origin", ref], work);
      git(["checkout", "--quiet", "-B", "isolated-lock", "FETCH_HEAD"], work);
      const prior = JSON.parse(readFileSync(join(work, "lock.json"), "utf8"));
      if (prior.target !== "byuwuoivuuklcwmoesrx" || prior.status !== "free") throw new Error(`isolated target locked by ${prior.release_id || "unknown"}`);
    } else {
      git(["checkout", "--quiet", "--orphan", "isolated-lock"], work);
      // An orphan checkout inherits the source index. The lock ref must contain
      // only lock.json, never the application tree or ignored local files.
      git(["rm", "-r", "--cached", "--ignore-unmatch", "."], work);
    }
    try { commit("held"); } catch (error) { throw new Error(`isolated target lock push failed: ${String(error.stderr || "concurrent compare-and-swap rejected").trim().slice(0, 300)}`); }
    acquired = true;
    const result = action();
    completed = true;
    return result;
  } finally {
    try {
      // An exception may happen after the target was partially mutated. Keep
      // the durable lock held until an operator reconciles that state.
      if (acquired && completed) commit("free");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}
