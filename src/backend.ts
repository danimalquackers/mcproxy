import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    ListToolsRequestSchema,
    ListToolsResultSchema,
    CallToolRequestSchema,
    CallToolResultSchema,
    Tool
} from "@modelcontextprotocol/sdk/types.js";
import { ServerConfig, ServerState } from "./types.js";

export const serverStates = new Map<string, ServerState>();
export const globalSchemaCache = new Map<string, Tool[]>();

export function resolveEnv(value: string): string {
    return value.replace(/\${([^}]+)}/g, (_, varName) => process.env[varName] || "");
}

export async function initServer(serverId: string, serverConfig: ServerConfig): Promise<void> {
    console.log(`\n[+] Initializing backend: ${serverId}`);
    serverStates.set(serverId, { status: "starting" });

    const transportType = serverConfig.transport || "stdio";
    let clientTransport: any;

    try {
        const resolvedHeaders: Record<string, string> = {};
        if (serverConfig.headers) {
            for (const [key, val] of Object.entries(serverConfig.headers)) {
                resolvedHeaders[key] = resolveEnv(val);
            }
        }

        switch (transportType) {
            case "stdio": {
                if (!serverConfig.command) throw new Error(`Missing 'command' for stdio transport.`);

                const sanitizedProcessEnv = Object.fromEntries(
                    Object.entries(process.env).filter(([_, value]) => value !== undefined)
                ) as Record<string, string>;

                clientTransport = new StdioClientTransport({
                    command: serverConfig.command,
                    args: serverConfig.args,
                    env: { ...sanitizedProcessEnv, ...serverConfig.env }
                });
                break;
            }
            case "sse": {
                if (!serverConfig.url) throw new Error(`Missing 'url' for sse transport.`);
                clientTransport = new SSEClientTransport(new URL(serverConfig.url), { headers: resolvedHeaders });
                break;
            }
            case "streamable-http": {
                if (!serverConfig.url) throw new Error(`Missing 'url' for streamable-http transport.`);

                clientTransport = new StreamableHTTPClientTransport(new URL(serverConfig.url), { headers: resolvedHeaders });
                break;
            }
            default:
                throw new Error(`Unknown transport type '${transportType}'.`);
        }

        const backendClient = new Client({ name: `proxy-client-${serverId}`, version: "1.0.0" }, { capabilities: {} });
        await backendClient.connect(clientTransport);

        const backendToolsResponse = await backendClient.request({ method: "tools/list" }, ListToolsResultSchema);
        const originalToolsCache: Tool[] = backendToolsResponse.tools;
        globalSchemaCache.set(serverId, originalToolsCache);

        const proxyServer = new Server({ name: `lazy-proxy-${serverId}`, version: "1.0.0" }, { capabilities: { tools: {} } });

        proxyServer.setRequestHandler(ListToolsRequestSchema, async () => {
            const minifiedTools: Tool[] = originalToolsCache.map(tool => ({
                name: tool.name,
                description: `[SCHEMA STRIPPED] You MUST call 'get_tool_details' on MCProxy Master Server with { "server_name": "${serverId}", "tool_name": "${tool.name}" } first. Original: ${tool.description || "None"}`,
                inputSchema: { type: "object", properties: {} }
            }));
            return { tools: minifiedTools };
        });

        proxyServer.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                return await backendClient.request({ method: "tools/call", params: { name, arguments: args } }, CallToolResultSchema);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                return { content: [{ type: "text", text: `Backend execution failed: ${errorMessage}` }], isError: true };
            }
        });

        serverStates.set(serverId, {
            status: "running",
            proxyServer,
            backendClient,
            clientTransport
        });
        console.log(`[✓] Successfully initialized: ${serverId}`);
    } catch (error: unknown) {
        serverStates.set(serverId, {
            status: "error",
            errorMsg: error instanceof Error ? error.message : String(error)
        });

        throw error;
    }
}

export function createMasterServer(): Server {
    console.log(`\n[+] Initializing MCProxy Master Server...`);
    const masterServer = new Server({ name: "mcproxy-master", version: "1.0.0" }, { capabilities: { tools: {} } });

    masterServer.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [{
                name: "get_tool_details",
                description: "Fetch the full original JSON schema for a tool from any proxied server. Call this before using any tool that has a stripped schema.",
                inputSchema: {
                    type: "object",
                    properties: {
                        server_name: { type: "string" },
                        tool_name: { type: "string" }
                    },
                    required: ["server_name", "tool_name"]
                }
            }]
        };
    });

    masterServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        if (name === "get_tool_details") {
            const serverName = args?.server_name as string | undefined;
            const toolName = args?.tool_name as string | undefined;

            if (!serverName || !toolName) return { content: [{ type: "text", text: "Error: Missing arguments." }], isError: true };

            const serverTools = globalSchemaCache.get(serverName);
            if (!serverTools) return { content: [{ type: "text", text: `Error: Server '${serverName}' not found in cache.` }], isError: true };

            const requestedTool = serverTools.find(t => t.name === toolName);
            if (!requestedTool) return { content: [{ type: "text", text: `Error: Tool '${toolName}' not found.` }], isError: true };

            return { content: [{ type: "text", text: JSON.stringify(requestedTool.inputSchema, null, 2) }] };
        }
        return { content: [{ type: "text", text: `Error: Unknown tool '${name}'.` }], isError: true };
    });

    return masterServer;
}
