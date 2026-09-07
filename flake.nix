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
    };
}
