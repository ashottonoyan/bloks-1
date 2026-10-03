// Agents filing agents into sidebar sections: at hire, and for teammates.
// A section is only a label, so another agent may set that and nothing
// else; every other field stays the agent's own, or the person's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness } from "./helpers/server.ts";

test("an agent can hire into a section and file a teammate, and change nothing else of theirs", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-sections-"));
  const out = join(home, "answers.json");
  const cli = join(home, "fake-claude.mjs");
  // Told CALLS <base64 json>, makes each request with its turn credential and
  // writes down what came back.
  writeFileSync(
    cli,
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
const [first] = process.argv.slice(2);
if (first === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
if (first === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  const asked = input.match(/CALLS ([A-Za-z0-9+\\/=]+)/);
  if (asked) {
    const calls = JSON.parse(Buffer.from(asked[1], "base64").toString("utf8"));
    const answers = [];
    for (const [method, path, body] of calls) {
      const res = await fetch(process.env.BLOKS_URL + path, {
        method,
        headers: { authorization: "Bearer " + process.env.BLOKS_TOKEN, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      answers.push({ status: res.status, body: await res.json().catch(() => null) });
    }
    writeFileSync(${JSON.stringify(out)}, JSON.stringify(answers));
  }
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done" }));
});
`,
    { mode: 0o755 },
  );
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ instances: { claude: { driver: "claudeAgent", config: { cli } } } }));
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });

  const { bot: manager } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Travel Manager" }) });
  await h.fetch(`/api/bots/${manager.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
  const { bot: teammate } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Lisbon" }) });

  const run = async (calls: unknown[]) => {
    rmSync(out, { force: true });
    await h.fetch(`/api/bots/${manager.id}/messages`, { method: "POST", body: JSON.stringify({ text: `CALLS ${Buffer.from(JSON.stringify(calls)).toString("base64")}` }) });
    for (let i = 0; i < 200 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(out), "the turn never ran");
    return JSON.parse(readFileSync(out, "utf8")) as Array<{ status: number; body: any }>;
  };
  const idle = async () => {
    for (let i = 0; i < 200; i++) {
      const { bots } = await h.json("/api/bots");
      if (!bots.find((b: any) => b.id === manager.id).busy) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  const [hired, filed, tooMuch, mixed] = await run([
    ["POST", "/api/bots", { name: "Porto", section: "  travel  " }],
    ["PATCH", `/api/bots/${teammate.id}`, { section: "travel" }],
    ["PATCH", `/api/bots/${teammate.id}`, { name: "Renamed" }],
    ["PATCH", `/api/bots/${teammate.id}`, { section: "x", approvals: "full" }],
  ]);
  assert.ok(hired.status < 300, JSON.stringify(hired.body));
  assert.equal(hired.body.bot.section, "travel", "a hire was not filed into its section");
  assert.ok(filed.status < 300, JSON.stringify(filed.body));
  assert.equal(tooMuch.status, 403, "an agent renamed a teammate");
  assert.equal(mixed.status, 403, "a section rode along with a field that is not one");

  await idle();
  const { bots } = await h.json("/api/bots");
  const lisbon = bots.find((b: any) => b.id === teammate.id);
  assert.equal(lisbon.section, "travel");
  assert.equal(lisbon.name, "Lisbon");
  assert.notEqual(lisbon.approvals, "full");
});
