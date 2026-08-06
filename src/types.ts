import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface ServerConfig {
    transport?: "stdio" | "sse" | "streamable-http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
}

export interface Config {
    mcpServers: Record<string, ServerConfig>;
}

export interface ServerState {
    status: "starting" | "running" | "error";
    errorMsg?: string;
    proxyServer?: Server;
    backendClient?: Client;
    clientTransport?: any; // Allows graceful closure on restart
}
