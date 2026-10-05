# Unsuspicious Industries website

This repository contains the source for [unsuspicious.org](https://unsuspicious.org), built with [HRML](https://github.com/Unsuspicious-Industries/hrml) and its `xrml` command-line tool.

## Develop and build

The generator this repository pins comes from its own flake, so a working copy
needs no second install:

```sh
nix develop    # xrml on PATH, the revision flake.lock names
nix run        # serve a dev instance of this checkout, with source reloads
```

Colour is not in this repository. Templates write `USI_<ROLE>` tokens and the
generator resolves them from a palette file passed at render time; without one it
writes the tokens out literally, the browser drops every declaration, and the
page renders in browser defaults instead of the house palette. The hexes live in
the `ui` design system; until `ui` publishes them as a flake input, pass the file
explicitly:

```sh
xrml serve . --palette <usi-palette-corporate.toml>   # dev server on :8080
xrml build . --palette <usi-palette-corporate.toml>   # static output to dist/
USI_PALETTE=<file> nix run                            # the same, through the flake app
```

`nix build .#site` renders without a palette and so is not a preview of anything.

A bare checkout is also not the whole site. `data/people/` is filled by the fleet
from its identity data and copied into the served checkout, so `/about` here
renders an empty team grid while production lists the members; the same holds for
the generated `static/graphics/corporate.pdf`.

## Site files

- `xrml.toml` configures the site.
- `templates/layouts/` contains the base layout.
- `templates/components/` contains reusable components.
- `templates/pages/` contains page templates; their paths determine routes.
- `data/posts/` and `data/jobs/` contain the site's MDX content.
- `static/` contains stylesheets, images, fonts, icons and other assets.

To add a page, create a `.hrml` file under `templates/pages/`. For example, `templates/pages/research.hrml` defines `/research`. Add a navigation link separately in `templates/components/nav.hrml` if the page should appear in the navigation.

## License

MIT
