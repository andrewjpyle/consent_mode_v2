import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
