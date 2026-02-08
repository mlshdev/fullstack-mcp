import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFetchDocumentation } from "../tools/fetch-documentation.js";
import { registerSearchDocumentation } from "../tools/search-documentation.js";
import { registerGetPage } from "../tools/get-page.js";
import { registerListSources } from "../tools/list-sources.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "docs-server",
    version: "1.0.0",
  });

  registerFetchDocumentation(server);
  registerSearchDocumentation(server);
  registerGetPage(server);
  registerListSources(server);

  return server;
}
