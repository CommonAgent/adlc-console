#!/usr/bin/env node
// Refreshes standards/stages.json, the copy of the 24 ADLC stages this
// package ships.
//
// The stages' home is standards/stages.json in the adlc repository
// (CommonAgent/adlc); this script copies it from there. If that file cannot
// be read, it builds the same fields from the stages page,
// https://agenticdevelopment.ai/stages.html, as a fallback.
//
//   node scripts/vendor-stages.mjs                 copy from the adlc repo (the page if that fails)
//   node scripts/vendor-stages.mjs --page <file>   build from a saved copy of the page
//
// Only maintainers run this. The console itself never fetches the stages.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ADLC_RAW = "https://raw.githubusercontent.com/CommonAgent/adlc/main/standards/stages.json";
const PAGE = "https://agenticdevelopment.ai/stages.html";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "standards", "stages.json");

// The person's gates, where the lifecycle puts them: approve the spec,
// approve the impact report, your OK on the code, approve the install, and
// Acceptance, which a person holds.
const PERSON_GATES = new Set(["requirements", "impact", "code", "deploy", "acceptance"]);

const text = (html) =>
  html
    .replace(/<li>/g, " ")
    .replace(/<\/li>/g, ";")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*$/, "")
    .replace(/:\s*;?\s*/g, ": ")
    .trim();

function dd(block, label) {
  const re = new RegExp(`<dt>${label}</dt><dd>([\\s\\S]*?)</dd>`, "g");
  return [...block.matchAll(re)].map((m) => text(m[1]));
}

export function parsePage(html) {
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  const assets = assetNames();
  const stages = [];
  let phase = null;
  const re = /<h2 class="phase-head" id="phase-([a-z-]+)">|<section class="stage[^"]*" id="([a-z-]+)">([\s\S]*?)<\/section>/g;
  for (const m of main.matchAll(re)) {
    if (m[1]) { phase = m[1]; continue; }
    if (phase === "beside") break;
    const id = m[2];
    const body = m[3];
    const head = body.match(/<div class="head">([\s\S]*?)<\/div>/)?.[1] ?? "";
    const name = text(head.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] ?? id);
    const holder = head.match(/class="agent-on"[^>]*>([^<]+)</)?.[1] ?? null;
    const roles = dd(body, "Role");
    const given = dd(body, "Given");
    const back = dd(body, "Hands back");
    const parts = [...body.matchAll(/<h3>([^<]+)<\/h3>/g)].map((p) => p[1]);
    const join2 = (list) => list.length > 1 && parts.length === list.length
      ? list.map((v, i) => `${parts[i]}: ${v}`).join(". ")
      : list.join(". ");
    stages.push({
      id,
      number: stages.length + 1,
      phase,
      name,
      role: join2(roles),
      reference_holder: holder,
      given: join2(given),
      hands_back: join2(back),
      done_when: dd(body, "Done when")[0] ?? "",
      asset: assets[id] ?? null,
      person_gate: PERSON_GATES.has(id),
    });
  }
  return stages;
}

// What each stage makes, from https://agenticdevelopment.ai/assets.html.
function assetNames() {
  return {
    requirements: "Statement of the job",
    architecture: "Architecture record and Design",
    impact: "Impact report",
    source: "Catalog answers",
    test: "Test suite",
    code: "Code",
    review: "Review findings",
    security: "Security statement",
    package: "The package",
    release: "Signed build record",
    deploy: "Signed Descriptor and registration, and signed deployment record",
    conformance: "Conformance verdict",
    acceptance: "Acceptance",
    docs: "AgentDoc",
    publish: "Published address",
    retract: "Retraction record",
    monitor: null,
    eval: "Graded judgments",
    incident: "Incident records",
    cost: "Receipts, usage and cost",
    update: "Change records",
    reconfigure: "Change records",
    rollback: "Change records",
    decommission: "Decommission record",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const pageAt = args.indexOf("--page");
  let doc;
  if (pageAt === -1) {
    try {
      const r = await fetch(ADLC_RAW);
      if (r.ok) {
        const stages = await r.json();
        doc = { source: ADLC_RAW, ...(Array.isArray(stages) ? { stages } : stages) };
      }
    } catch { /* fall through to the page */ }
  }
  if (!doc) {
    const html = pageAt === -1
      ? await (await fetch(PAGE)).text()
      : await readFile(args[pageAt + 1], "utf8");
    doc = {
      source: `Built from ${PAGE} on ${new Date().toISOString().slice(0, 10)}, because ${ADLC_RAW} could not be read.`,
      stages: parsePage(html),
    };
  }
  if (doc.stages.length !== 24) throw new Error(`expected 24 stages, found ${doc.stages.length}`);
  await writeFile(OUT, JSON.stringify(doc, null, 2) + "\n");
  console.log(`wrote ${doc.stages.length} stages to ${OUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
