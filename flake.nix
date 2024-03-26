{
  inputs = {
    nixpkgs = {
      url = "github:nixos/nixpkgs/nixpkgs-unstable";
    };
    nixpkgs-node14.url = github:NixOS/nixpkgs?rev=nixpkgs/a71323f68d4377d12c04a5410e214495ec598d4c;
  };
  outputs = {nixpkgs, nixpkgs-node14, ...}: let
    systems = ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"];
    forAllSystems = nixpkgs.lib.genAttrs systems;
  in {
    formatter = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
      in
        pkgs.alejandra
    );
    devShells = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        pkgs-node14 = nixpkgs-node14.legacyPackages.${system};
        node = pkgs-node14.nodejs_14;
        corepackEnable = pkgs.runCommand "corepack-enable" {} ''
          mkdir -p $out/bin
          ${node}/bin/corepack enable --install-directory $out/bin
        '';
      in {
        default = with pkgs;
          mkShell {
            buildInputs = [
              corepackEnable
              bun
              deno
              node
            ];
          };
      }
    );
  };
}
