# Unsuspicious Industries website

This repository contains the source for [unsuspicious.org](https://unsuspicious.org), built with [HRML](https://github.com/Unsuspicious-Industries/hrml) and its `xrml` command-line tool.

## Develop and build

The generator and the palette both come from this flake, so a working copy needs
no second install and no arguments:

```sh
nix develop    # xrml on PATH, USI_PALETTE set to the pinned corporate palette
nix run        # serve a dev instance of this checkout, with source reloads
```

Templates write `USI_<ROLE>` tokens and the generator resolves them from a TOML
palette at render time; without one it writes the tokens out literally, the
browser drops every declaration, and the page renders in browser defaults instead
of the house palette. The palette is a flake input here -
`usi-ui.lib.paletteFile`, pinned in `flake.lock`, the same helper the fleet's
serve unit calls - so a dev render and the served site resolve the same file.
Fetching it needs an ssh key with access to the private USI repositories.
`USI_PALETTE=<file>` overrides it, which is how you preview another palette:

```sh
xrml serve . --palette "$USI_PALETTE"   # dev server on :8080
xrml build . --palette "$USI_PALETTE"   # static output to dist/
```

`nix build .#site` renders the same tree into a store path with the pinned
palette; the apex itself is served live from a git checkout rather than from it.

A bare checkout is also not the whole site. The fleet replaces `data/people/` at
serve start with the profiles it projects from its identity data, so `/about` here
renders an empty team grid while production lists the members; the same holds for
the generated `static/graphics/corporate.pdf`. Nothing under `data/people/` except
`.keep` may be committed: the serve step refuses a tracked profile, and `.gitignore`
keeps a generated one out of the tree. To correct a name, role or biography, edit
the profile in the ENT - it writes `config/profiles.json` in the fleet repository -
and the change appears once the fleet activates, not on the next content sync.

## Site files

- `xrml.toml` configures the site.
- `templates/layouts/` contains the base layout.
- `templates/components/` contains reusable components.
- `templates/pages/` contains page templates; their paths determine routes.
- `data/posts/` and `data/jobs/` contain the site's MDX content.
- `static/` contains stylesheets, images, fonts, icons and other assets.

## Style reference

`/style` is the palette of record, defined by `templates/pages/style.hrml`: each
swatch is drawn with the live custom property and each value printed through
`$globals`, so the page renders the palette the site was served with instead of a
copy of it. It took the place of the `colors.pdf` card, which was a snapshot and
could drift from the site it documented.

To add a page, create a `.hrml` file under `templates/pages/`. For example, `templates/pages/research.hrml` defines `/research`. Add a navigation link separately in `templates/components/nav.hrml` if the page should appear in the navigation.

## Tool previews

`templates/pages/tools.hrml` puts examples above the descriptions so each card
shows what the tool produces, and each card is one `<?use id="tool-card"?>` over
`templates/components/tool-card.hrml`. The HRML badge lives in
`templates/components/badge.hrml`; the preview is drawn by that component rather
than a separate HTML mockup, and the snippet above it is a copy of its
declaration.

The Remblais demo uses `static/images/remblais-square.gif`, copied unchanged
from `morph_big.gif` in Remblais at `3b57978`. It shows a white square separating
into red, green and blue blocks. Its SHA-256 is
`f78bffb74c9c55430092e363d21f4d64920aea6bdfe4a671a6b6e3098e948f57`.
No new GPU render or conservation measurement was performed. A reduced-motion
`<picture>` source uses frame 95 as `remblais-square-still.png`. A native **Still**
checkbox lets other readers stop the visible loop without changing system
preferences; it swaps in that frame, rather than freezing the current one.
The still was extracted with ImageMagick 7.1.2-31 on MIST:

```sh
magick morph_big.gif -coalesce -delete 0-94,96--1 remblais-square-still.png
```

Project identity marks are separate from previews. Their source is the
`usi-ui` flake input: `components/brand/project-icons.hrml` (geometry),
`project-icon.hrml` (renderer) and `lib/project-icons.nix` (stable project ids).
This checkout keeps exact component snapshots so raw `xrml serve` works;
`nix build .#site` rejects a snapshot that differs from the pinned library and
checks every rendered project-icon reference. Redesign icons in `usi-ui`, not
in the snapshots. To refresh them after updating the input:

```sh
nix flake update usi-ui
icons=$(nix build .#project-icons --no-link --print-out-paths)
cp "$icons"/*.hrml templates/components/
```

Add a project to the shared registry and sprite together. Use `project-icon`
with its registered id wherever its identity is shown; keep explanatory diagrams
and animation previews local to the page. While previewing untracked additions,
build with `nix build "path:$PWD#site"`: Git-flake `.#site` excludes untracked files.

Political Alignment's values come from its
[README at ff88c4d](https://github.com/Unsuspicious-Industries/political-alignement/blob/ff88c4dd2648d18112b85252e3864eb5be86b2e7/README.md),
rounded to whole units. Its `embedding.py` computes Euclidean distance between
mean-pooled output logits. These examples were not reproduced here and do not
establish political scores or cross-model comparability.

## Checks

```sh
nix flake check "path:$PWD"
nix run "path:$PWD#check-browser" -- http://localhost:8080
# Optional screenshots and the assertion trace:
CHECK_ARTIFACTS=/tmp/usi-check nix run "path:$PWD#check-browser" -- http://localhost:8080
```

The browser runner is optional, pinned with its Chromium binary, and kept in
`tools/check-site.cjs`. It checks responsive layout, decoded images, project
marks and links, page anchors, keyboard menu operation, the GIF's playback and
native Still control, and reduced-motion selection. It prints the machine and
tool versions. Supply a different base URL to test a served build. These are
static and browser assertions plus visual inspection, not a proof of
accessibility or of what the diagrams represent.

## License

MIT
