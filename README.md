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
keeps a generated one out of the tree.

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

## License

MIT
