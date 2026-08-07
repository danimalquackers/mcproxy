{
  description = "MCP proxy with lazy schema loading";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      packages = forAllSystems (system:
        let pkgs = pkgsFor system;
        in {
          mcproxy = pkgs.buildNpmPackage {
            pname = "mcproxy";
            version = "0.0.1";

            nativeBuildInputs = with pkgs; [
              nodejs_22
              typescript
              tsx
            ];

            src = ./.;
            npmDepsHash = "sha256-GtufK/i8LyfT25O4ldnzYOQbjUwBCiy/GzKOsnrJLW8=";
          };
          default = self.packages.${system}.mcproxy;
        }
      );

      devShells = forAllSystems (system:
        let pkgs = pkgsFor system;
        in {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              nodejs_22
              typescript
              typescript-language-server
              tsx
            ];
          };
        }
      );

      homeManagerModules = {
        mcproxy = import ./module.nix self;
        default = self.homeManagerModules.mcproxy;
      };
    };
}