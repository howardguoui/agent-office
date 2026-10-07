#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  DEFAULT_BASE_URL,
  ensureBroker,
  requestBroker,
} from "../broker/client.js";


const mcpServer = new Server(
  { name: "agent-office", version: "2.0.0" },
  { capabilities: { tools: {} } },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "agent_office_status",
      description:
        "Get current Agent Office status for simultaneous Claude and Codex sessions",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "agent_office_open",
      description: "Open or focus the Agent Office visualization panel",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "agent_office_status") {
    const state = await requestBroker("/state");
    const activeAgents = state.agents.filter(
      (agent) => agent.status !== "done",
    );
    const bySource = activeAgents.reduce((counts, agent) => {
      counts[agent.source] = (counts[agent.source] || 0) + 1;
      return counts;
    }, {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              activeAgents: activeAgents.length,
              bySource,
              toolCounts: state.toolCounts,
              recentEvents: state.events.slice(-10),
              url: DEFAULT_BASE_URL,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  if (request.params.name === "agent_office_open") {
    await requestBroker("/open", { method: "POST" });
    return {
      content: [
        { type: "text", text: `Agent Office opened at ${DEFAULT_BASE_URL}` },
      ],
    };
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

try {
  await ensureBroker();
} catch (error) {
  process.stderr.write(`[Agent Office] ${error.message}\n`);
}

const transport = new StdioServerTransport();
await mcpServer.connect(transport);

