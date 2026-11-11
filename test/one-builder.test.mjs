// The console for the one-builder lifecycle (lifecycle API 0.5.0, the ADLC one-builder plan,
// step 6): the architecture record and the Common Agent checks each on a tab of their own, and
// send_back's choice of stage drawn as a choice.
import test from "node:test";
import assert from "node:assert/strict";
import { architectureOf, checkedDocuments, architectureTabHtml, conformanceTabHtml, actionButtonsHtml, actionKey } from "../public/workspace.js";

const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const record = { id: "architecture", kind: "architecture", stage: "architecture", state: "made", name: "The architecture record", version: "v1", summary: { systems: ["hacker-news"], bindings: { "hacker-news": { dev: { product: "itself", provided_by: "itself" } } }, kind: "plugin-on-harness", decisions: [{ decided: "Read the official API", why: "the person said so" }] } };
const check = (section, result) => ({ standard: "common-agent", version: "0.41.0", section, result, asks: `rule ${section}`, detail: "" });
const files = { id: "files", kind: "statement", stage: "architecture", state: "made", name: "The agent's own files", checks: [check("12.6", "met"), check("12.4", "not_met")] };
const pkg = { id: "package", kind: "package", stage: "package", state: "made", name: "The package", checks: [check("12.10", "not_checked")] };

test("the architecture record is on a tab of its own, apart from the Design's files", () => {
  const b = { artifacts: [files, record] };
  assert.equal(architectureOf(b), record);
  const html = visible(architectureTabHtml(b));
  assert.match(html, /^The architecture record, version v1\./);
  assert.match(html, /hacker-news/);
  assert.match(html, /Read the official API/);
  assert.match(visible(architectureTabHtml({ artifacts: [files] })), /^No architecture record yet\./);
});

test("the Common Agent checks of every document are on a tab of their own, with the version's tally", () => {
  const b = { artifacts: [record, files, pkg] };
  assert.deepEqual(checkedDocuments(b).map((a) => a.id), ["files", "package"]);
  const html = visible(conformanceTabHtml(b));
  assert.match(html, /^1 met, 1 not met, 1 not checked, against Common Agent 0\.41\.0\./);
  assert.ok(html.indexOf("The agent's own files") < html.indexOf("The package"));
  assert.match(html, /Section 12\.6/);
  assert.match(visible(conformanceTabHtml({ artifacts: [record] })), /^No Common Agent checks yet\./);
});

test("send_back's stage is a choice of the earlier stages, the nearest chosen first", () => {
  const a = { stage: "test", name: "send_back", label: "Send back", needs: [{ name: "to", label: "The stage to send it back to", kind: "choice", options: ["requirements", "architecture"], default: "architecture" }, { name: "changes", label: "What should change, for that stage", kind: "words" }] };
  const html = actionButtonsHtml([a], { asking: `${a.stage}\n${actionKey(a)}` });
  assert.match(html, /<select id="need-to" name="to" required><option value="requirements">requirements<\/option><option value="architecture" selected>architecture<\/option><\/select>/);
  assert.match(html, /<textarea id="need-changes" name="changes" required><\/textarea>/);
});
