import { execFileSync } from "node:child_process";

// This adapter selects the Git-built preview for one immutable commit. It never
// assigns an alias and never executes code from the candidate checkout.
const cli = ["--yes", "vercel@62.1.0"];
function vercel(args, token, input) {
  const separator = args.indexOf("--");
  const before = separator < 0 ? args : args.slice(0, separator);
  const after = separator < 0 ? [] : args.slice(separator);
  const safeEnv = { ...process.env };
  for (const name of ["STRIPE_TEST_SECRET_KEY", "STRIPE_TEST_WEBHOOK_SECRET", "STAGE_SUPABASE_ACCESS_TOKEN", "SUPABASE_ACCESS_TOKEN", "STAGE_VERCEL_TOKEN"]) delete safeEnv[name];
  const bypass = safeEnv.VERCEL_AUTOMATION_BYPASS_SECRET;
  delete safeEnv.VERCEL_AUTOMATION_BYPASS_SECRET;
  // Vercel CLI reads this only for protected Preview requests.
  if (args[0] === "curl" && bypass) safeEnv.VERCEL_AUTOMATION_BYPASS_SECRET = bypass;
  try {
    return execFileSync("npx", [...cli, ...before, "--scope", "gunnar-picklaats-projects", ...(token ? ["--token", token] : []), ...after], {
      encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
      ...(input === undefined ? {} : { input }),
      env: safeEnv,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  } catch {
    // Node's child-process error includes the full command, including the
    // token argument. Never allow it into a release record or Actions log.
    throw new Error(`Vercel ${args[0]} operation failed`);
  }
}

export function parseServedRelease(raw) {
  const boundary = raw.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
  const cut = raw.lastIndexOf(boundary);
  if (cut < 0) throw new Error("preview response has no HTTP headers");
  const headers = raw.slice(0, cut).toLowerCase();
  const body = JSON.parse(raw.slice(cut + boundary.length));
  if (!/^http\/2 200|^http\/1\.1 200/.test(headers) || !/^age:\s*0\s*$/m.test(headers) || !/^cache-control:.*no-store/m.test(headers)) throw new Error("preview identity is stale or cacheable");
  return body;
}

export function selectExactPreview(deployments, target, sha, deploymentUrl) {
  const candidates = deployments.filter((d) => d.state === "READY" && d.meta?.githubCommitSha === sha && d.meta?.githubCommitRef === target.preview_git_branch && d.createdAt > Date.parse(target.preview_env_verified_after) && (!deploymentUrl || d.url === deploymentUrl));
  if (candidates.length !== 1) throw new Error(`exact SHA preview count ${candidates.length}; expected one`);
  const deployment = candidates[0];
  if (!deployment.url.endsWith(target.preview_domain_suffix) || target.forbidden_domains.some((domain) => deployment.url === domain || deployment.url.endsWith(`.${domain}`))) throw new Error("preview uses protected domain");
  return deployment;
}

export function exactPreviewRequest(target, sha, releaseId) {
  if (target.vercel_project_id !== "prj_ZXHb62NWhYVlIrj2yaEZekIxgJVV" || target.preview_git_branch !== "codex/release-v1-20261001" || !/^[0-9a-f]{40}$/.test(sha) || !/^rel-[0-9a-f]{12}-[0-9a-f]{8}$/.test(releaseId)) throw new Error("unapproved exact-SHA preview request");
  return {
    name: "pickla-flow-1b995a61", project: target.vercel_project_id,
    gitSource: { type: "github", repoId: 1160297393, org: "guggeuber", repo: "pickla-flow-1b995a61", ref: target.preview_git_branch, sha },
    meta: { picklaReleaseId: releaseId },
    // Omitting target is required: the API then creates a Preview, never a
    // production or staging alias.
  };
}

export function createExactPreview(target, sha, releaseId, token = process.env.STAGE_VERCEL_TOKEN) {
  const request = exactPreviewRequest(target, sha, releaseId);
  const listing = JSON.parse(vercel(["list", "pickla-flow-1b995a61", "--json", "--limit", "100"], token));
  const existing = (listing.deployments || []).filter((d) => d.meta?.picklaReleaseId === releaseId);
  if (existing.length > 1) throw new Error("multiple deployments for one release; reconcile before retry");
  let deployment = existing[0];
  if (deployment && (deployment.meta?.githubCommitSha !== sha || deployment.meta?.githubCommitRef !== target.preview_git_branch)) throw new Error("release deployment tag points to another SHA or branch");
  if (!deployment) {
    deployment = JSON.parse(vercel(["api", "/v13/deployments", "-X", "POST", "--input", "-", "--raw"], token, JSON.stringify(request)));
  }
  const id = deployment.id || deployment.uid;
  if (!/^dpl_[A-Za-z0-9]+$/.test(id || "") || deployment.target === "production" || deployment.target === "staging" || (deployment.alias || []).some((alias) => target.forbidden_domains.some((domain) => alias === domain || alias.endsWith(`.${domain}`)))) throw new Error("created deployment target or alias is unsafe");
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const details = JSON.parse(vercel(["inspect", id, "--json"], token));
    if (details.readyState === "READY") {
      if (details.target !== "preview" || details.id !== id) throw new Error("created deployment is not an exact Preview");
      return id;
    }
    if (["ERROR", "CANCELED"].includes(details.readyState)) throw new Error(`exact-SHA preview build ${details.readyState}`);
    execFileSync("sleep", ["5"]);
  }
  throw new Error("exact-SHA preview build timed out; reconcile deployment ID before retry");
}

export function discoverExactPreview(target, sha, token = process.env.STAGE_VERCEL_TOKEN, deploymentId) {
  // `vercel list --json` does not include deployment IDs. Resolve the trusted
  // ID first, then match its immutable URL and Git metadata in the listing.
  const identified = deploymentId ? JSON.parse(vercel(["inspect", deploymentId, "--json"], token)) : null;
  if (identified && (identified.id !== deploymentId || identified.target !== "preview")) throw new Error("requested Preview deployment ID changed");
  const listing = JSON.parse(vercel(["list", "pickla-flow-1b995a61", "--json", "--limit", "100"], token));
  const candidate = selectExactPreview(listing.deployments || [], target, sha, identified?.url);
  const details = JSON.parse(vercel(["inspect", candidate.url, "--json"], token));
  if (identified && details.id !== deploymentId) throw new Error("Preview URL resolved to another deployment ID");
  if (details.readyState !== "READY" || details.target !== "preview" || !/^dpl_[A-Za-z0-9]+$/.test(details.id || "") || details.url !== candidate.url) throw new Error("Vercel deployment identity mismatch");
  const requestId = `release-${sha.slice(0, 16)}`;
  const response = vercel(["curl", `https://${candidate.url}/api/release?request_id=${requestId}`, "--", "--include", "--silent"], token);
  const served = parseServedRelease(response);
  if (served.sha !== sha || served.deployment_id !== details.id || served.deployment_url !== candidate.url || served.environment !== "preview" || served.request_id !== requestId) throw new Error("served preview release identity mismatch");
  const html = vercel(["curl", `https://${candidate.url}/`, "--", "--silent"], token);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.js)"/g)].map((match) => match[1]);
  if (!assets.length) throw new Error("preview build has no inspectable application bundle");
  const bundles = assets.map((asset) => vercel(["curl", `https://${candidate.url}${asset}`, "--", "--silent"], token));
  if (!bundles.some((bundle) => bundle.includes(`https://${target.supabase_ref}.supabase.co`))) throw new Error("preview does not contain isolated Supabase URL");
  if (bundles.some((bundle) => bundle.includes("https://ptnvhbniiiapzbyofctg.supabase.co") || bundle.includes("https://anpxxnpevtxhiajxmfji.supabase.co"))) throw new Error("preview contains protected Supabase URL");
  return { vercel_project_id: target.vercel_project_id, vercel_deployment_id: details.id, deployment_url: candidate.url, served_sha: served.sha, environment: served.environment, preview_git_branch: target.preview_git_branch, built_at: served.built_at, verified_at: new Date().toISOString() };
}
