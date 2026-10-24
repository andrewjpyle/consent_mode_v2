import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  CONSENT_KEY,
  EEA_UK,
  resolveInitialConsent,
  applyConsentChoice,
} from "../src/consent-init.js";

let calls;
let store;

function installGlobals({ trace, fetchFails = false, storageBlocked = false }) {
  calls = [];
  store = new Map();
  globalThis.window = { gtag: (...args) => calls.push(args) };
  globalThis.localStorage = {
    getItem: (k) => {
      if (storageBlocked) throw new Error("blocked");
      return store.has(k) ? store.get(k) : null;
    },
    setItem: (k, v) => {
      if (storageBlocked) throw new Error("blocked");
      store.set(k, v);
    },
  };
  globalThis.fetch = () =>
    fetchFails
      ? Promise.reject(new Error("network"))
      : Promise.resolve({ text: () => Promise.resolve(trace) });
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const updates = () => calls.filter((c) => c[0] === "consent");

beforeEach(() => installGlobals({ trace: "" }));

test("non-EEA visitor ends in an explicit update to granted", async () => {
  installGlobals({ trace: "fl=1\nloc=US\n" });
  resolveInitialConsent();
  await settle();
  assert.equal(updates().length, 1);
  assert.equal(updates()[0][1], "update");
  assert.equal(updates()[0][2].analytics_storage, "granted");
});

test("EEA visitor stays denied", async () => {
  installGlobals({ trace: "loc=DE\n" });
  resolveInitialConsent();
  await settle();
  assert.equal(updates()[0][2].analytics_storage, "denied");
});

test("UK visitor stays denied", async () => {
  installGlobals({ trace: "loc=GB\n" });
  resolveInitialConsent();
  await settle();
  assert.equal(updates()[0][2].analytics_storage, "denied");
});

test("fails closed when the geo lookup errors", async () => {
  installGlobals({ trace: "", fetchFails: true });
  resolveInitialConsent();
  await settle();
  assert.equal(updates()[0][2].ad_storage, "denied");
});

test("fails closed when the trace has no loc field", async () => {
  installGlobals({ trace: "fl=1\nh=example.com\n" });
  resolveInitialConsent();
  await settle();
  assert.equal(updates()[0][2].analytics_storage, "denied");
});

test("stored choice is re-applied without a geo lookup", async () => {
  installGlobals({ trace: "loc=US\n" });
  store.set(CONSENT_KEY, JSON.stringify({ choice: "denied", ts: 1 }));
  let fetched = false;
  globalThis.fetch = () => {
    fetched = true;
    return Promise.resolve({ text: () => Promise.resolve("loc=US") });
  };
  resolveInitialConsent();
  await settle();
  assert.equal(fetched, false);
  assert.equal(updates()[0][2].analytics_storage, "denied");
});

test("blocked localStorage falls through to the geo lookup", async () => {
  installGlobals({ trace: "loc=US\n", storageBlocked: true });
  resolveInitialConsent();
  await settle();
  assert.equal(updates()[0][2].analytics_storage, "granted");
});

test("an update sets all four signals together", async () => {
  installGlobals({ trace: "loc=US\n" });
  resolveInitialConsent();
  await settle();
  assert.deepEqual(Object.keys(updates()[0][2]).sort(), [
    "ad_personalization",
    "ad_storage",
    "ad_user_data",
    "analytics_storage",
  ]);
});

test("applyConsentChoice updates gtag and persists the choice", () => {
  installGlobals({ trace: "" });
  applyConsentChoice("granted");
  assert.equal(updates()[0][2].analytics_storage, "granted");
  assert.equal(JSON.parse(store.get(CONSENT_KEY)).choice, "granted");
});

test("applyConsentChoice still applies when storage is blocked", () => {
  installGlobals({ trace: "", storageBlocked: true });
  applyConsentChoice("denied");
  assert.equal(updates()[0][2].analytics_storage, "denied");
});

test("EEA_UK holds 30 EEA states plus GB", () => {
  assert.equal(EEA_UK.length, 31);
  assert.ok(EEA_UK.includes("GB"));
  assert.ok(!EEA_UK.includes("US"));
});

// The README says the per-stack files inline an equivalent of consent-init.js.
// These checks fail when a copy drifts from the source of truth.
const copies = [
  "src/react/ConsentMode.tsx",
  "src/react/CookieConsent.tsx",
  "src/server-rendered/consent-snippet.html",
  "src/vite/index-head-snippet.html",
];

for (const file of copies) {
  const text = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  test(`${file} uses the same storage key as consent-init.js`, () => {
    assert.ok(
      text.includes(`'${CONSENT_KEY}'`) || text.includes(`"${CONSENT_KEY}"`),
      `${file} does not reference ${CONSENT_KEY}`
    );
  });
}

for (const file of copies.filter((f) => /ConsentMode|snippet/.test(f))) {
  const text = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  test(`${file} inlines the full EEA/UK list`, () => {
    for (const code of EEA_UK) {
      assert.ok(text.includes(`'${code}'`) || text.includes(`"${code}"`), `${file} is missing ${code}`);
    }
  });
}

// A visitor can click Accept/Reject while the region lookup is still in flight.
// The explicit choice must win; the late geo result must not overwrite it.
test("a choice made while the lookup is in flight is not overwritten", async () => {
  installGlobals({ trace: "" });
  let release;
  globalThis.fetch = () =>
    new Promise((r) => { release = () => r({ text: () => Promise.resolve("loc=US\n") }); });
  resolveInitialConsent();
  applyConsentChoice("denied");
  release();
  await settle();
  const u = updates();
  assert.equal(u.length, 1, "only the visitor's own update should fire");
  assert.equal(u[0][2].analytics_storage, "denied");
});

test("a failed lookup does not overwrite a choice made meanwhile", async () => {
  installGlobals({ trace: "" });
  let fail;
  globalThis.fetch = () => new Promise((_, rej) => { fail = () => rej(new Error("network")); });
  resolveInitialConsent();
  applyConsentChoice("granted");
  fail();
  await settle();
  const u = updates();
  assert.equal(u.length, 1);
  assert.equal(u[0][2].analytics_storage, "granted");
});

// Run the inlined init script from each drop-in in a sandbox, so a copy that
// drifts from consent-init.js in behavior (not just in text) fails here.
function initScript(file) {
  const text = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  if (file.endsWith(".tsx")) {
    const m = text.match(/<Script id="gtag-init"[^>]*>\s*\{`([\s\S]*?)\$\{configLines/);
    assert.ok(m, "gtag-init template not found");
    return m[1];
  }
  const scripts = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  const head = scripts.find((x) => x.includes("consent', 'default'") || x.includes("consent','default'"));
  assert.ok(head, "head init script not found");
  return head;
}

function runInit(file, { trace, storedChoice, raceChoice }) {
  const store = new Map();
  if (storedChoice) store.set(CONSENT_KEY, JSON.stringify({ choice: storedChoice, ts: 1 }));
  let release;
  const sandbox = {
    window: {},
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    fetch: () => new Promise((r) => { release = () => r({ text: () => Promise.resolve(trace) }); }),
    Date, JSON,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(initScript(file), sandbox);
  if (raceChoice) store.set(CONSENT_KEY, JSON.stringify({ choice: raceChoice, ts: 2 }));
  return {
    sandbox,
    finish: async () => { if (release) release(); await settle(); },
    updates: () => sandbox.dataLayer.map((a) => Array.from(a)).filter((a) => a[0] === "consent" && a[1] === "update"),
    defaults: () => sandbox.dataLayer.map((a) => Array.from(a)).filter((a) => a[0] === "consent" && a[1] === "default"),
  };
}

const inlined = ["src/react/ConsentMode.tsx", "src/vite/index-head-snippet.html", "src/server-rendered/consent-snippet.html"];

for (const file of inlined) {
  test(`${file} defaults all four signals to denied`, () => {
    const r = runInit(file, { trace: "loc=US\n" });
    const d = r.defaults()[0][2];
    assert.deepEqual(
      [d.ad_storage, d.analytics_storage, d.ad_user_data, d.ad_personalization],
      ["denied", "denied", "denied", "denied"]
    );
  });

  test(`${file} grants outside the EEA and denies inside it`, async () => {
    const us = runInit(file, { trace: "loc=US\n" });
    await us.finish();
    assert.equal(us.updates()[0][2].analytics_storage, "granted");
    const de = runInit(file, { trace: "loc=DE\n" });
    await de.finish();
    assert.equal(de.updates()[0][2].analytics_storage, "denied");
  });

  test(`${file} keeps a choice made while the lookup is in flight`, async () => {
    const r = runInit(file, { trace: "loc=US\n", raceChoice: "denied" });
    await r.finish();
    assert.equal(r.updates().length, 0);
  });

  test(`${file} re-applies a stored choice without a lookup`, async () => {
    const r = runInit(file, { trace: "loc=US\n", storedChoice: "denied" });
    await r.finish();
    assert.equal(r.updates().length, 1);
    assert.equal(r.updates()[0][2].analytics_storage, "denied");
  });
}

// The banner accent follows the host site's --primary token, teal as fallback.
for (const file of ["src/react/CookieConsent.tsx", "src/server-rendered/consent-snippet.html"]) {
  test(`${file} reads the accent from --primary with a teal fallback`, () => {
    const text = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.ok(text.includes("var(--primary, #43ccad)"));
    const bare = text.replace(/var\(--primary, #43ccad\)/g, "").match(/#43ccad/g);
    assert.equal(bare, null, "a hardcoded #43ccad bypasses --primary");
  });
}
