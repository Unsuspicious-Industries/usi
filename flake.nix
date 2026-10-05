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
      packages.${system}.site = pkgs.runCommand "usi-site" {
        nativeBuildInputs = [ xrml ];
      } ''
        cp -r ${self}/. ./source
        chmod -R u+w ./source
        cd ./source
        xrml build --palette ${palette} >/dev/null
        cp -r dist $out
      '';

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
      apps.${system}.default = {
        type = "app";
        program = "${pkgs.writeShellScript "usi-site-dev" ''
          set -eu
          [ "$#" -gt 0 ] || set -- serve .
          exec ${xrml}/bin/xrml "$@" --palette "''${USI_PALETTE:-${palette}}"
        ''}";
      };
    };
}
