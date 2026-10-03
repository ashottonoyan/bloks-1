// The desktop app's window, when it runs against another computer, is
// served by a small proxy on this one (electron/remote.mjs). Its storage
// (folded sections, the sidebar, cards you closed) belongs to the page's
// origin, which includes the port, so the port has to be one it can keep.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { startRemoteProxy } from "../electron/remote.mjs";

const ui = mkdtempSync(join(tmpdir(), "bloks-remote-ui-"));
writeFileSync(join(ui, "index.html"), "<!doctype html><title>Bloks</title>");
after(() => rmSync(ui, { recursive: true, force: true }));

// a relay nobody answers on: the proxy keeps retrying it quietly
const profile = { relayUrl: "http://127.0.0.1:9", relayToken: "t", deviceId: "d", deviceToken: "token" };

test("the proxy comes back on the port it is given, so the window keeps its storage", async () => {
  const first = await startRemoteProxy(profile, { staticDir: ui });
  const port = first.port;
  first.stop();
  await new Promise((r) => setTimeout(r, 50));
  const again = await startRemoteProxy(profile, { staticDir: ui, port });
  try {
    assert.equal(again.port, port);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
  } finally {
    again.stop();
  }
});

test("a port someone else took fails at once instead of hanging", async () => {
  const squatter = createServer();
  await new Promise<void>((r) => squatter.listen(0, "127.0.0.1", () => r()));
  const taken = (squatter.address() as { port: number }).port;
  try {
    const outcome = await Promise.race([
      startRemoteProxy(profile, { staticDir: ui, port: taken }).then(
        (proxy) => (proxy.stop(), "started"),
        () => "refused",
      ),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 3000)),
    ]);
    assert.equal(outcome, "refused");
  } finally {
    squatter.close();
  }
});
