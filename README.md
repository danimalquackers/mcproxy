# MCProxy 🚀

MCProxy is an MCP server proxy designed to reduce Model Context Protocol (MCP) context window bloat while preserving LLM client permissions. It strips heavy metadata and JSON schemas from backend tool definitions during the discovery phase, forcing LLM clients to fetch full schemas dynamically on-demand via a deduplicated Master Server.

> Disclosure: This project contains code generated mostly by Gemini, with human editing. It is not intended to be production-ready and is not feature-complete and compatible with all scenarios.

## Features

* **Context Compression:** Strips heavy descriptions, nested properties, and large enums from backend tools, reducing token overhead significantly while preserving client-side policies and call-time permissions.
* **Master Metadata Routing:** Exposes a single `get_tool_details` helper tool on a master endpoint (`/mcp`) so individual backend servers stay uncluttered.
* **Multi-Transport Support:** Manages backend servers running over **Stdio**, **Server-Sent Events (SSE)**, and modern **Streamable HTTP**.
* **Fleet Management Web UI:** Includes an embedded dashboard at `/status` displaying live server statuses and a simple one-click **Restart** action for individual downed or unauthenticated backends.
* **Nix & Home Manager Native:** Easily deployable and configurable declaratively using Nix derivations and Home Manager modules.

---

## Project Structure

```text
src/
├── types.ts           # TypeScript interfaces and state types
├── backendManager.ts  # MCP SDK client/server lifecycle, transport factories, & caching
├── index.ts           # Express routing, Fleet Manager UI logic, & entry point
└── views/
    └── status.ejs     # EJS template for the Fleet Status dashboard
```

## Getting Started & Development

### Prerequisites

* Node.js (v22+)
* Nix (optional, but recommended for development and deployment)

### Local Development (via Nix DevShell)

Clone the repository and enter the Nix development environment:

```bash
nix develop
npm install
```

Start the proxy locally using tsx:

```bash
npm run dev
```

### Configuration (mcpServers.json)

MCProxy is configured via a JSON file (or generated via Nix) defining your backend MCP servers. It supports environment variable interpolation using the ${VAR_NAME} syntax.

```json
{
  "filesystem": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/code"]
  },
  "github": {
    "transport": "sse",
    "url": "https://mcp.internal.mycompany.com/github/sse",
    "headers": {
      "Authorization": "Bearer ${GITHUB_TOKEN}"
    }
  }
}
```

### Nix & Home Manager Integration

This repository includes a `flake.nix` and `module.nix` to integrate MCProxy seamlessly into your Home Manager setup.

#### Enable the Service

In your Home Manager configuration, enable the proxy, define your backend servers, and pipe the auto-generated configuration directly into your system-wide MCP client setup (`programs.mcp`):

```nix
{ config, pkgs, inputs, ... }: {

  services.mcproxy = {
    enable = true;
    port = 11262;
    servers = {
      filesystem = {
        transport = "stdio";
        command = "npx";
        args = [ "-y" "@modelcontextprotocol/server-filesystem" "/home/user/code" ];
      };
    };
  };

  # Automatically exposes the Master and Proxied Streamable HTTP endpoints
  programs.mcp = {
    enable = true;
    servers = config.services.mcproxy.generatedConfig;
  };
}
```

#### Status Dashboard

Once running, MCProxy exposes a built-in web management portal at: http://127.0.0.1:11262/status.

* **Live Monitoring:** View whether your backend servers are RUNNING, STARTING, or encountering an ERROR (such as a 401 Unauthorized token expiration).
* **Individual Restarts:** If a backend server drops or requires an updated OAuth token, resolve the issue externally and click Restart right from the UI to re-initialize that specific backend without restarting the entire proxy fleet.
