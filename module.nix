self: { config, lib, pkgs, ... }:

let
  cfg = config.services.mcproxy;
  jsonFormat = pkgs.formats.json {};

  # Generated config file passed to the server
  configFile = jsonFormat.generate "mcpServers.json" {
    mcpServers = cfg.servers;
  };

  # Produce a Nix attrset to provide to programs.mcp
  computedMcpServers = {
    mcproxy = {
      url = "http://127.0.0.1:${toString cfg.port}/mcp";
    };
  } // (builtins.mapAttrs (name: _: {
    url = "http://127.0.0.1:${toString cfg.port}/servers/${name}/mcp";
  }) cfg.servers);
in {
  options.services.mcproxy = {
    enable = lib.mkEnableOption "MCP proxy with lazy schema loading";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.system}.default;
      description = "The derivation containing the compiled mcproxy application.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 11262;
      description = "The port the Express server will listen on for Streamable HTTP connections.";
    };

    servers = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule ({ name, config, ... }: {
        options = {
          transport = lib.mkOption {
            type = lib.types.enum [ "stdio" "sse" "streamable-http" ];
            default = "stdio";
            description = "The transport type for the MCP server.";
          };

          command = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "The command to run for stdio transport.";
          };

          args = lib.mkOption {
            type = lib.types.nullOr (lib.types.listOf lib.types.str);
            default = null;
            description = "Arguments to pass to the command.";
          };

          env = lib.mkOption {
            type = lib.types.nullOr (lib.types.attrsOf lib.types.str);
            default = null;
            description = "Environment variables to set for the command.";
          };

          url = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "The URL for sse or streamable-http transport.";
          };

          headers = lib.mkOption {
            type = lib.types.nullOr (lib.types.attrsOf lib.types.str);
            default = null;
            description = "Headers to set for the connection.";
          };
        };
      }));
      default = {};
      example = {
        filesystem = {
          type = "stdio";
          command = "npx";
          args = [ "-y" "@modelcontextprotocol/server-filesystem" "/home/user/projects" ];
        };
      };
      description = "The backend MCP server configurations. This generates the mcpServers.json file.";
    };

    proxyServers = lib.mkOption {
      type = lib.types.attrs;
      readOnly = true;
      description = "An auto-generated attrset mapping server names to their local proxy HTTP URLs. Designed to be passed to programs.mcp.servers.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = lib.flatten (lib.mapAttrsToList (name: server: [
      {
        assertion = server.transport == "stdio" -> server.command != null;
        message = "MCP server ${name} has transport set to stdio but no command is provided";
      }
      {
        assertion = server.transport == "sse" || server.transport == "streamable-http" -> server.url != null;
        message = "MCP server ${name} has transport set to ${server.transport} but no url is provided";
      }
    ] cfg.servers));

    services.mcproxy.proxyServers = computedMcpServers;

    # Create the user-level systemd service
    systemd.user.services.mcproxy = {
      Unit = {
        Description = "MCP proxy with lazy schema loading";
        After = [ "network.target" ];
      };

      Service = {
        # Assuming the provided package derivation links the executable to bin/mcp-lazy-proxy
        ExecStart = "${cfg.package}/bin/mcproxy";
        
        # Pass configuration via environment variables so the TS code is environment-agnostic
        Environment = [
          "PORT=${toString cfg.port}"
          "CONFIG_PATH=${configFile}"
        ];
        
        Restart = "on-failure";
        RestartSec = "5s";
      };

      Install = {
        WantedBy = [ "default.target" ];
      };
    };
  };
}