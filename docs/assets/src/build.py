"""Build the README graphics for consent_mode_v2.

    python docs/assets/src/build.py
    uv run --with playwright==1.56.0 --with pillow python docs/assets/src/render.py docs/assets/src docs/assets

hero, architecture and dropins are structural. The EEA/UK count and the file list are read from
src/, so they cannot drift from the code. anatomy renders ONLY from captures/npm_test.json, a real
`node --test test/consent-init.test.js` run (selected lines, verbatim; durations are as printed).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import readme_kit as k  # noqa: E402

REPO = "CONSENT_MODE_V2"
INIT = (ROOT / "src" / "consent-init.js").read_text(encoding="utf-8")
EEA_UK = re.findall(r"'([A-Z]{2})'", INIT.split("export var EEA_UK")[1].split("];")[0])
assert len(EEA_UK) == 31, f"expected 31 region codes, found {len(EEA_UK)}"


def hero() -> str:
    # One node per branch of resolveInitialConsent() and applyConsentChoice(); each ends in an update.
    paths = ["Stored", "Non-EEA", "EEA/UK", "No loc", "Net error", "Banner"]
    return k.hero(
        "CONSENT-MODE-V2 · JS DROP-INS · MIT",
        "Every path", "ends in an update.",
        "A page-level <code style='font-family:JetBrains Mono;font-size:16px;color:var(--ivory)'>default</code> does not beat the Google tag's own "
        "denied default. Only an explicit <b style='color:var(--ivory);font-weight:600'>consent update</b> does. So every branch here sends one.",
        [("Default denied, then update", "All four signals start denied. A stored choice, a region result or a click then sets them."),
         ("Fails closed", "No Cloudflare, a blocked request or a missing region all resolve to denied."),
         ("Same-origin region lookup", "Reads /cdn-cgi/trace on your own host. No third-party geo call.")],
        f"{len(EEA_UK)} REGION CODES · 4 SIGNALS · 0 DEPENDENCIES",
        k.wheel(paths, "ALWAYS", "update", size=560, node_r=52),
        f"{REPO} · HOW IT WORKS")


def architecture() -> str:
    boxes = (k.box(56, 210, 250, 200, "PAGE LOAD", ["gtag('js')", "consent default:", "4 signals denied", "wait_for_update 2000"])
             + k.box(396, 210, 270, 200, "STORED CHOICE?", ["localStorage", "cookie_consent_v1", "yes: re-apply it", "blocked storage = none"])
             + k.box(776, 210, 250, 200, "CONSENT UPDATE", ["explicit update call", "sets all 4 signals", "overrides the tag's", "denied default"], True)
             + k.box(1116, 210, 228, 200, "GOOGLE TAG", ["gcs=G111 granted", "gcs=G100 denied", "check the outbound", "hit, not the install"])
             + k.box(396, 450, 270, 190, "REGION LOOKUP", ["fetch /cdn-cgi/trace", "read loc=XX", f"{len(EEA_UK)} codes = EEA + UK", "skipped if choice saved"], True)
             + k.box(776, 450, 250, 190, "LOOKUP RESULT", ["outside: granted", "EEA/UK: denied", "no loc or error: denied", "late result yields"])
             + k.box(1116, 450, 228, 190, "BANNER", ["until a choice", "Accept / Reject", "update + save choice", "a click beats lookup"]))
    arrows = [(306, 310, 386, 310), (666, 310, 766, 310), (1026, 310, 1106, 310),
              (531, 410, 531, 440, "none", False, "right"), (666, 545, 766, 545),
              (901, 450, 901, 420), (1230, 450, 1230, 420)]
    return k.flow("HOW IT WORKS", f"Default denied, then {k.em('always update')}.",
                  "read-only in the page · no third-party request · no build step",
                  boxes, arrows, f"{REPO} · HOW IT WORKS")


def dropins() -> str:
    files = {
        "src/react/ConsentMode.tsx": ("NEXT.JS", "gtag loader, init and banner in one component", "<ConsentMode gaId=... />"),
        "src/react/CookieConsent.tsx": ("REACT BANNER", "Accept / Reject banner, inline styles", "accent: var(--primary)"),
        "src/vite/index-head-snippet.html": ("VITE / SPA", "head snippet for index.html", "paste before other tags"),
        "src/server-rendered/consent-snippet.html": ("SERVER-RENDERED", "head part plus banner part, vanilla JS", "Django, WordPress, static"),
    }
    cards = []
    for rel, (label, desc, hint) in files.items():
        assert (ROOT / rel).exists(), rel
        cards.append((label, desc, rel.split("/", 1)[1], hint))
    return k.catalog("THE DROP-INS", f"Copy one file. {k.em('That is the install.')}",
                     "src/consent-init.js is the source of truth; each stack inlines an equivalent so it stays zero-dependency.",
                     cards, f"{REPO} · FILES READ FROM src/", cols=2, card_height=170)


def anatomy() -> str:
    c = k.load_capture(HERE / "captures" / "npm_test.json")
    out = c["output"].splitlines()
    want = ("non-EEA visitor", "EEA visitor stays", "fails closed when the geo lookup errors",
            "a choice made while the lookup is in flight", "src/vite/index-head-snippet.html keeps a choice",
            "src/server-rendered/consent-snippet.html grants outside", "src/react/CookieConsent.tsx reads the accent")
    picked = [next(ln for ln in out if ln.startswith("✔ " + w)) for w in want]
    assert len(picked) == len(want), f"expected {len(want)} matching lines, found {len(picked)}"
    summary = [ln for ln in out if re.match(r"^ℹ (tests|pass|fail) ", ln)]
    assert len(summary) == 3, summary

    def code(ln: str) -> tuple[str, str]:
        return ("code", f"<span style='font-size:13px'>{k.esc(ln)}</span>")

    lines = [("h1", "node --test test/consent-init.test.js"),
             ("q", "Node's built-in runner. No install step, no dependencies.")]
    lines += [code(ln) for ln in picked]
    lines.append(("m", f"{len(picked)} of the {summary[0].split()[-1]} test lines, verbatim"))
    lines += [code(ln) for ln in summary]
    lines.append(("m", f"captured {c['captured_at'][:10]} at commit {c['commit'][:9]}"))
    notes = [(185, "The init logic runs against a fake gtag, storage and fetch."),
             (245, "A choice made during the lookup is never overwritten."),
             (300, "The inlined copies run in a sandbox too, so they cannot drift."),
             (350, "The accent test fails if a hardcoded teal replaces --primary.")]
    return k.anatomy("ANATOMY OF A REAL TEST RUN", lines, notes, f"{REPO} · REAL RUN {c['captured_at'][:10]}", doc_width=860)


if __name__ == "__main__":
    k.write_pages(HERE, {"hero": hero(), "architecture": architecture(), "dropins": dropins(), "anatomy": anatomy()})
