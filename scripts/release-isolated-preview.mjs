import { execFileSync } from "node:child_process";

// This adapter selects the Git-built preview for one immutable commit. It never
// assigns an alias and never executes code from the candidate checkout.
const cli = ["--yes", "vercel@62.1.0"];
function vercel(args, token) {
  const separator = args.indexOf("--");
  const before = separator < 0 ? args : args.slice(0, separator);
  const after = separator < 0 ? [] : args.slice(separator);
  return execFileSync("npx", [...cli, ...before, "--scope", "gunnar-picklaats-projects", ...(token ? ["--token", token] : []), ...after], {
    encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

export function selectExactPreview(deployments, target, sha) {
  const candidates = deployments.filter((d) => d.state === "READY" && d.meta?.githubCommitSha === sha && d.meta?.githubCommitRef === target.preview_git_branch && d.createdAt > Date.parse(target.preview_env_verified_after));
  if (candidates.length !== 1) throw new Error(`exact SHA preview count ${candidates.length}; expected one`);
  const deployment = candidates[0];
  if (!deployment.url.endsWith(target.preview_domain_suffix) || target.forbidden_domains.some((domain) => deployment.url === domain || deployment.url.endsWith(`.${domain}`))) throw new Error("preview uses protected domain");
  return deployment;
}

export function discoverExactPreview(target, sha, token = process.env.STAGE_VERCEL_TOKEN) {
  const listing = JSON.parse(vercel(["list", "pickla-flow-1b995a61", "--json", "--limit", "100"], token));
  const candidate = selectExactPreview(listing.deployments || [], target, sha);
  const details = JSON.parse(vercel(["inspect", candidate.url, "--json"], token));
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
