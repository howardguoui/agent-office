#!/usr/bin/env node
// MCP server that Claude Code uses as its --permission-prompt-tool when the companion sends it work.
// Each permission request is forwarded to the local broker, which asks Howard in the companion's bubble.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { askBroker } from "./approval-client.js";

const port = Number.parseInt(process.env.AGENT_OFFICE_PORT || "4242", 10);
const brokerUrl = `http://127.0.0.1:${port}/companion/approval`;

const server = new Server({ name: "companion", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "approve",
      description: "Ask Howard, through his desktop companion, whether Claude Code may use a tool.",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: { type: "string" },
          input: { type: "object" },
          tool_use_id: { type: "string" },
        },
        required: ["tool_name", "input"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "approve") {
    return { isError: true, content: [{ type: "text", text: `Unknown tool ${request.params.name}` }] };
  }
  const args = request.params.arguments || {};
  const decision = await askBroker({ toolName: args.tool_name, input: args.input || {} }, { url: brokerUrl });
  return { content: [{ type: "text", text: JSON.stringify(decision) }] };
});

await server.connect(new StdioServerTransport());
