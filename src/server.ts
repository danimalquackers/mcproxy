import express from "express";
import fs from "fs";
import path from "path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Config } from "./types.js";
import { serverStates, initServer, createMasterServer } from "./backend.js";

const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 11262;
const CONFIG_PATH: string = process.env.CONFIG_PATH || "./mcpServers.json";

let config: Config = { mcpServers: {} };

export async function startApp(): Promise<void> {
    // 1. Load Configuration
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch (error) {
        console.error(`[!] Failed to read config file at ${CONFIG_PATH}`);
        process.exit(1);
    }

    const app = express();
    app.use(express.urlencoded({ extended: true }));

    // Set up EJS templating engine views path
    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "views"));

    // 2. Initialize Backend Servers
    for (const [serverId, serverConfig] of Object.entries(config.mcpServers)) {
        try {
            await initServer(serverId, serverConfig);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[!] Failed to initialize backend '${serverId}': ${errorMessage}`);
        }
    }

    const masterServer = createMasterServer();

    // =================================================================
    // WEB UI: Status Page & Restart Endpoints
    // =================================================================

    app.get("/status", (req, res) => {
        // Render the external EJS template, passing variables cleanly
        res.render("status", { config, serverStates });
    });

    app.post("/servers/:serverId/restart", async (req, res) => {
        const { serverId } = req.params;
        const serverConfig = config.mcpServers[serverId];
        if (!serverConfig) return res.status(404).send("Server not found in config.");

        const state = serverStates.get(serverId);
        if (state?.clientTransport && typeof state.clientTransport.close === "function") {
            try { await state.clientTransport.close(); } catch (e) { /* ignore cleanup errors */ }
        }

        // Fire and forget initialization so UI responds immediately
        try {
            await initServer(serverId, serverConfig);
            res.redirect("/status");
        } catch (error) {
            console.error(`[!] Failed to restart server ${serverId}:`, error);
            res.redirect("/status");
        }
    });

    // =================================================================
    // DYNAMIC IDE ROUTING
    // =================================================================

    app.post(`/servers/:serverId/mcp`, async (req, res) => {
        const { serverId } = req.params;
        const state = serverStates.get(serverId);

        if (!state) return res.status(404).send("Server not configured.");

        if (state.status === "error") {
            const isAuthError = state.errorMsg?.includes("401") || state.errorMsg?.includes("invalid_token") || state.errorMsg?.includes("Authentication failed");
            return res.status(isAuthError ? 401 : 500).json({
                error: isAuthError ? "invalid_token" : "server_error",
                error_description: state.errorMsg
            });
        }

        if (state.status !== "running" || !state.proxyServer) {
            return res.status(503).send("Server is currently starting or unavailable.");
        }

        try {
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            res.on("close", () => transport.close());
            await state.proxyServer.connect(transport);
            await transport.handleRequest(req, res);
        } catch (error) {
            console.error(`[!] Streamable HTTP error on ${serverId}:`, error);
            if (!res.headersSent) res.status(500).send("Internal Transport Error");
        }
    });

    // =================================================================
    // MASTER SERVER ROUTE
    // =================================================================

    app.post(`/mcp`, async (req, res) => {
        try {
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            res.on("close", () => transport.close());
            await masterServer.connect(transport);
            await transport.handleRequest(req, res);
        } catch (error) {
            console.error(`[!] Streamable HTTP error on Master Server:`, error);
            if (!res.headersSent) res.status(500).send("Internal Transport Error");
        }
    });

    app.listen(PORT, () => {
        console.log(`\n🚀 MCProxy Fleet Manager running on http://127.0.0.1:${PORT}`);
        console.log(`👉 View Fleet Status & Restarts: http://127.0.0.1:${PORT}/status`);
    });
}
