# Unsuspicious Industries website

This repository contains the source for [unsuspicious.org](https://unsuspicious.org), built with [HRML](https://github.com/Unsuspicious-Industries/hrml) and its `xrml` command-line tool.

## Install XRML

Install the published Rust package:

```sh
cargo install xrml
```

Or run it through Nix, as described in the [XRML README](https://github.com/Unsuspicious-Industries/hrml#run-from-nix).

## Develop and build

Run these commands from the repository root:

```sh
xrml dev
xrml build
```

`xrml dev` serves the site locally with source reloads. `xrml build` writes static output to `dist/`.

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
