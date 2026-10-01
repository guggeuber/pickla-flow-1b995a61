import { execFileSync } from "node:child_process";

export function verifyIsolatedBranch(target, token = process.env.STAGE_SUPABASE_ACCESS_TOKEN) {
  const output = execFileSync("npx", ["--yes", "supabase@2.113.0", "branches", "list", "--project-ref", target.supabase_parent_ref, "--output", "json"], {
    encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...(token ? { SUPABASE_ACCESS_TOKEN: token } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const branches = JSON.parse(output);
  const matches = branches.filter((branch) => branch.project_ref === target.supabase_ref);
  if (matches.length !== 1) throw new Error("isolated Supabase branch unavailable");
  const branch = matches[0];
  if (branch.id !== target.supabase_branch_id || branch.parent_project_ref !== target.supabase_parent_ref || branch.preview_project_status !== "ACTIVE_HEALTHY" || branch.with_data !== false || branch.persistent !== true) throw new Error("isolated Supabase branch identity or health changed");
  // MIGRATIONS_FAILED is a workflow state, not proof that the schema is absent.
  // Deployed behavior and the ledger are separate gates.
  return { ref: branch.project_ref, branch_id: branch.id, parent_ref: branch.parent_project_ref, status: branch.status, preview_project_status: branch.preview_project_status, with_data: branch.with_data, persistent: branch.persistent };
}
