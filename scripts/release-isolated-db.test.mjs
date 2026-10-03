import test from "node:test";
import assert from "node:assert/strict";
import { classifyPsqlFailure, selectIsolatedSessionPooler } from "./release-isolated-db.mjs";

const ref = "byuwuoivuuklcwmoesrx";
const target = { supabase_ref: ref, supabase_parent_ref: "ptnvhbniiiapzbyofctg", supabase_branch_id: "4aec1694-5d7d-4691-9228-a03c156371bc" };
const response = {
  SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_JWT_SECRET: "synthetic-jwt", SUPABASE_ANON_KEY: "synthetic-anon",
  POSTGRES_URL_NON_POOLING: `postgresql://postgres:synthetic-password@db.${ref}.supabase.co:5432/postgres`,
  POSTGRES_URL: `postgresql://postgres.${ref}:synthetic-password@aws-0-eu-north-1.pooler.supabase.com:6543/postgres`,
};

test("trusted control-plane pooler URL becomes branch-bound session mode", () => {
  const selected = selectIsolatedSessionPooler(response, target);
  assert.equal(selected.url.hostname, "aws-0-eu-north-1.pooler.supabase.com");
  assert.equal(selected.url.port, "5432");
  assert.equal(decodeURIComponent(selected.url.username), `postgres.${ref}`);
});

test("pooler refuses a different branch, host or database credential", () => {
  for (const changed of [
    { ...response, POSTGRES_URL: response.POSTGRES_URL.replace(ref, "anpxxnpevtxhiajxmfji") },
    { ...response, POSTGRES_URL: response.POSTGRES_URL.replace("pooler.supabase.com", "pooler.supabase.com.evil.test") },
    { ...response, POSTGRES_URL: response.POSTGRES_URL.replace("synthetic-password", "other-password") },
    { ...response, SUPABASE_URL: "https://anpxxnpevtxhiajxmfji.supabase.co" },
  ]) assert.throws(() => selectIsolatedSessionPooler(changed, target), /identity unavailable/);
  assert.throws(() => selectIsolatedSessionPooler(response, { ...target, supabase_branch_id: "unknown" }), /identity unavailable/);
});

test("psql failure classification emits only non-secret categories", () => {
  assert.equal(classifyPsqlFailure({ stderr: "could not translate host name secret-host" }), "dns");
  assert.equal(classifyPsqlFailure({ stderr: "Network is unreachable" }), "network");
  assert.equal(classifyPsqlFailure({ stderr: "FATAL: password authentication failed for user secret-user" }), "auth");
  assert.equal(classifyPsqlFailure({ stderr: "ERROR: relation venues does not exist" }), "database");
  assert.equal(classifyPsqlFailure({ stderr: "unrecognized secret text" }), "unknown");
});
