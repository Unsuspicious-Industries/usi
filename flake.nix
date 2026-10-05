{
  description = "Unsuspicious Industries public website";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    hrml.url = "github:Unsuspicious-Industries/hrml";
  };

  outputs = { self, nixpkgs, hrml }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      xrml = hrml.packages.${system}.xrml;
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

      packages.${system}.site = pkgs.runCommand "usi-site" {
        nativeBuildInputs = [ xrml ];
      } ''
        cp -r ${self}/. ./source
        chmod -R u+w ./source
        cd ./source
        xrml build >/dev/null
        cp -r dist $out
      '';

      checks.${system}.site = self.packages.${system}.site;

      # The generator this repo's own hrml input pins, on PATH for a working
      # copy. Colours are NOT here: templates write USI_<ROLE> tokens and the
      # generator resolves them from a palette file passed at render time, so a
      # serve without --palette emits the tokens verbatim and the browser drops
      # every declaration. The hexes live in servers/config/style.nix; see
      # servers/common/xrml.nix for the file the serve unit passes.
      devShells.${system}.default = pkgs.mkShell {
        name = "usi-site";
        packages = [ xrml ];
        shellHook = ''
          cat <<'EOF'
xrml is on PATH (pinned by this flake's hrml input). Colours are not in this
repo - pass the fleet palette or the USI_ tokens ship unresolved:
  xrml serve . --palette <usi-palette-corporate.toml>
EOF
        '';
      };

      apps.${system}.default = {
        type = "app";
        program = "${xrml}/bin/xrml";
      };
    };
}
