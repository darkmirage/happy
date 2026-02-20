/**
 * Happy MCP server
 * Provides Happy CLI specific tools including chat session title management
 *
 * Uses per-request McpServer + StreamableHTTPServerTransport instances
 * as required by @modelcontextprotocol/sdk >=1.26.0 (GHSA-345p-7cg4-v4c7).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { hostname } from "node:os";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";

export async function startHappyServer(client: ApiSessionClient) {
    logger.debug(`[happyMCP] server:start sessionId=${client.sessionId}`);

    // Handler that sends title updates via the client
    const handler = async (title: string) => {
        const prefixedTitle = `[${hostname()}] ${title}`;
        logger.debug('[happyMCP] Changing title to:', prefixedTitle);
        try {
            // Send title as a summary message, similar to title generator
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: prefixedTitle,
                leafUuid: randomUUID()
            });

            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    /**
     * Create a fresh McpServer with the change_title tool registered.
     * A new instance is needed per request to avoid cross-client data leaks
     * when sharing server/transport instances (GHSA-345p-7cg4-v4c7).
     */
    function createMcpServer(): McpServer {
        const mcp = new McpServer({
            name: "Happy MCP",
            version: "1.0.0",
        });

        mcp.registerTool('change_title', {
            description: 'Change the title of the current chat session',
            title: 'Change Chat Title',
            inputSchema: {
                title: z.string().describe('The new title for the chat session'),
            },
        }, async (args) => {
            const response = await handler(args.title);
            logger.debug('[happyMCP] Response:', response);

            if (response.success) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Successfully changed chat title to: "${args.title}"`,
                        },
                    ],
                    isError: false,
                };
            } else {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                        },
                    ],
                    isError: true,
                };
            }
        });

        return mcp;
    }

    //
    // Create the HTTP server
    //

    const server = createServer(async (req, res) => {
        try {
            const mcp = createMcpServer();
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined
            });
            await mcp.connect(transport);
            await transport.handleRequest(req, res);
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    logger.debug(`[happyMCP] server:ready sessionId=${client.sessionId} url=${baseUrl.toString()}`);

    return {
        url: baseUrl.toString(),
        toolNames: ['change_title'],
        stop: () => {
            logger.debug(`[happyMCP] server:stop sessionId=${client.sessionId}`);
            server.close();
        }
    }
}
