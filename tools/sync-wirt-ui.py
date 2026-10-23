#!/usr/bin/env python3
"""Refresh only the website snapshots; Wirt remains their source owner.

--check uses only this checkout (also run by the Nix build). To reproduce the
adaptation, pass --upstream PATH --check; omit --check to refresh from that tree.
No fetch, deployment or API access is performed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
REVISION = "dc2322709bd7f24e89f5041710638143dc19c731"
MAPPINGS = {
    "demo/ui/pages/index.hrml": "templates/pages/wirt.hrml",
    "demo/ui/static/js/playground.js": "static/js/wirt-playground.js",
    "demo/fixtures/c-addition-qwen3.5-0.8b.json": "static/wirt/c-addition-qwen3.5-0.8b.json",
}
LOCAL_REPLAY = '''    // Website-only static replay: never goes through the metered API.
    const localReplay = $("pg-local-replay");
    if (localReplay) localReplay.addEventListener("click", async () => {
        localReplay.disabled = true;
        try {
            const { body } = await api(localReplay.dataset.fixture);
            if (!state.connected) {
                state.grammars = [body.grammar];
                fillGrammars();
            }
            replay(body);
            setStatus("Static recording loaded — no GPU request made.");
        } catch (error) {
            setStatus(`Static recording unavailable: ${error.message}`, "bad");
        } finally {
            localReplay.disabled = false;
        }
    });

'''


def replace_once(text, old, new):
    assert text.count(old) == 1, f"Upstream adaptation anchor changed: {old!r}"
    return text.replace(old, new)


def adapt(name, raw):
    if name.endswith("index.hrml"):
        text = raw.decode()
        text = replace_once(text, "<?style?>\n", '''<!-- Wirt owns this UI; snapshot provenance: tools/wirt-ui-source.json. -->
<?style?>
/* Corporate palette aliases; geometry/layout otherwise follows Wirt. */
main {
    --ground: var(--bg-page);
    --surface: var(--bg-section);
    --ink: var(--text-default);
    --ink-dim: var(--text-muted);
    --rule: var(--border);
}
/* Let narrow controls and long labels wrap rather than widen the page. */
.pg-row { flex-wrap: wrap; }
.pg-row > * { min-width: 7rem; }
.pg-box-head { flex-wrap: wrap; }
''')
        text = replace_once(text, "Proposition 7 · playground", "Wirt · Proposition 7 playground")
        text = replace_once(text, '<div class="pg-wrap">', '''<div class="pg-wrap">
    <div class="pg-banner pg-idle">
        <p><strong>Source preview, not live backend qualification.</strong> The recording below is static and free to view. Live use requires a qualified same-origin API; preparing this page does not establish that it is deployed.</p>
    </div>
    <div class="pg-actions" style="margin-bottom: 1rem;">
        <button class="pg-btn pg-btn-ghost" id="pg-local-replay" type="button" data-fixture="/static/wirt/c-addition-qwen3.5-0.8b.json" aria-describedby="pg-local-note">Replay recorded C addition — no GPU</button>
        <p class="pg-hint" id="pg-local-note">Real Wirt recording, qwen3.5-0.8b. All three answers are shown, including the mixed arm’s forced reasoning closure. This is not a new measurement.</p>
    </div>''')
        text = replace_once(text, '<?use id="footer"?></?use?>', '<script src="/static/js/wirt-playground.js" defer></script>')
        return text.encode()
    if name.endswith("playground.js"):
        return replace_once(raw.decode(), '    el.connect.addEventListener("click", connect);', LOCAL_REPLAY + '    el.connect.addEventListener("click", connect);').encode()
    return raw


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest_path = ROOT / "tools/wirt-ui-source.json"
    if args.upstream:
        revision = subprocess.check_output(["git", "-C", str(args.upstream), "rev-parse", "HEAD"], text=True).strip()
        assert revision == REVISION, f"Expected Wirt {REVISION}, got {revision}"
        upstream = {name: (args.upstream / name).read_bytes() for name in MAPPINGS}
        # Check the files themselves against the commit, not just HEAD's name.
        for name, raw in upstream.items():
            assert raw == subprocess.check_output(["git", "-C", str(args.upstream), "show", f"{REVISION}:{name}"]), f"Dirty upstream: {name}"
        adapted = {dest: adapt(name, upstream[name]) for name, dest in MAPPINGS.items()}
        manifest = {
            "upstream": "Wirt", "revision": REVISION,
            "upstream_files": {name: sha(raw) for name, raw in upstream.items()},
            "site_files": {name: sha(raw) for name, raw in adapted.items()},
            "adaptation": "Reproduced by tools/sync-wirt-ui.py: corporate palette aliases, narrow-layout wrapping, existing site layout/footer, Wirt label and script path, explicit source-preview notice, optional static replay button/listener. All API/generation logic unchanged; fixture byte-identical. Wirt remains authoritative. No live backend qualification or public rollout implied.",
        }
        if args.check:
            assert json.loads(manifest_path.read_text()) == manifest, "Provenance differs from upstream adaptation"
            for name, raw in adapted.items():
                assert (ROOT / name).read_bytes() == raw, f"Adaptation differs: {name}"
        else:
            for name, raw in adapted.items():
                (ROOT / name).parent.mkdir(parents=True, exist_ok=True)
                (ROOT / name).write_bytes(raw)
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    else:
        assert args.check, "Use --upstream PATH to refresh"
        manifest = json.loads(manifest_path.read_text())
        assert manifest["revision"] == REVISION
        assert set(manifest["site_files"]) == set(MAPPINGS.values())
        for name, expected in manifest["site_files"].items():
            assert sha((ROOT / name).read_bytes()) == expected, f"Snapshot hash mismatch: {name}"
    print(f"PASS: Wirt {REVISION} snapshot hashes" + (" and upstream adaptation" if args.upstream else ""))


if __name__ == "__main__":
    main()
