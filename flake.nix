{
  description = "Unsuspicious Industries public website";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    hrml.url = "github:Unsuspicious-Industries/hrml";
    # The design system. Private, so fetching it needs an ssh key with access to
    # the USI repos; pinned in flake.lock like any other input, so a dev render
    # and the served site resolve the same file rather than two copies of the
    # hexes. `usi-ui.lib.paletteFile` is the helper servers calls too.
    usi-ui.url = "git+ssh://git@github.com/Unsuspicious-Industries/ui.git";
  };

  outputs = { self, nixpkgs, hrml, usi-ui }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      xrml = hrml.packages.${system}.xrml;
      # `usi.style.assign` puts the apex on the corporate palette: outbound,
      # clients read it.
      palette = usi-ui.lib.paletteFile { inherit pkgs; name = "corporate"; };
    in
    {
      # The portal and Nix deployer consume this metadata without knowing
      # anything about the site's templates.
      usiSite = {
        schema = 1;
        kind = "institutional";
        title = "USI";
        domain = "unsuspicious.org";
        owner = "collective";
        output = "packages.x86_64-linux.site";
      };

      # Rendered with the palette above rather than without one: a palette-less
      # `xrml build` exits 0 and writes every USI_<ROLE> token out literally,
      # which the browser then drops, so the export would look plausible and be
      # wrong.
      # Checked snapshots let the live checkout work with raw xrml, which
      # cannot import components outside its project tree. Geometry is owned by
      # usi-ui: changing these copies locally must fail, never fork silently.
      packages.${system} = {
        project-icons = pkgs.runCommand "usi-project-icons" { } ''
          mkdir -p $out
          cp ${usi-ui.lib.projectIconsSprite} $out/project-icons.hrml
          cp ${usi-ui.lib.projectIconComponent} $out/project-icon.hrml
        '';

        site = pkgs.runCommand "usi-site" {
          nativeBuildInputs = [ xrml pkgs.python3 pkgs.diffutils ];
        } ''
          cp -r ${self}/. ./source
          chmod -R u+w ./source
          cd ./source
          cmp templates/components/project-icons.hrml ${usi-ui.lib.projectIconsSprite}
          cmp templates/components/project-icon.hrml ${usi-ui.lib.projectIconComponent}
          xrml build --palette ${palette} >/dev/null
          python3 ${usi-ui}/tools/check-project-icons.py \
            --sprite templates/components/project-icons.hrml \
            --component templates/components/project-icon.hrml \
            --layout templates/layouts/base.hrml \
            --scan dist \
            ${pkgs.lib.concatMapStringsSep " " (id: "--expect ${id}") usi-ui.lib.projectIconIds}
          cp -r dist $out
        '';
      };

      checks.${system}.site = self.packages.${system}.site;

      devShells.${system}.default = pkgs.mkShell {
        name = "usi-site";
        packages = [ xrml ];
        shellHook = ''
          export USI_PALETTE=${palette}
          cat <<'EOF'
xrml is on PATH and USI_PALETTE names the corporate palette this flake pins:
  xrml serve . --palette "$USI_PALETTE"
Point USI_PALETTE at another palette file to render with that instead.
EOF
        '';
      };

      # `nix run` serves the checkout you are standing in - the command runs in
      # $PWD, not in the flake's store copy, or dev would serve a snapshot.
      # USI_PALETTE overrides the pinned palette; the default is an input, so
      # there is nothing to pass by hand and nothing to forget.
      apps.${system} = {
        default = {
          type = "app";
          program = "${pkgs.writeShellScript "usi-site-dev" ''
            set -eu
            [ "$#" -gt 0 ] || set -- serve .
            exec ${xrml}/bin/xrml "$@" --palette "''${USI_PALETTE:-${palette}}"
          ''}";
        };
        # Optional end-to-end checks: keep the browser out of the ordinary site
        # build, but pin its runner and binary together for repeatable assertions.
        check-browser = {
          type = "app";
          meta.description = "Check the served site with pinned Chromium and Playwright";
          program = "${pkgs.writeShellScript "usi-check-browser" ''
            set -eu
            export PLAYWRIGHT_CORE=${pkgs.playwright-driver}
            export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers-chromium}
            exec ${pkgs.nodejs}/bin/node ${self}/tools/check-site.cjs "$@"
          ''}";
        };
      };
    };
}
