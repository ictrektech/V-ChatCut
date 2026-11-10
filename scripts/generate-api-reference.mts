/** Generate documentation schemas without starting the server or reading credentials. */
import { readFile, writeFile } from 'node:fs/promises';
import { EXTERNAL_SESSION_TOOLS, externalDraftSchemas, externalGlobalReadSchemas, externalRealSchemas } from '../src/agent/external-tool-shape.ts';
import { isExternalDraftTool } from '../src/agent/external-tool-policy.ts';
import { MCP_CONTROL_TOOLS } from '../server/external-agent/mcp-controls.ts';
const source = JSON.parse(await readFile(new URL('../assets/agent/openchatcut-tool-schemas.json', import.meta.url), 'utf8'));
const tools = [...externalGlobalReadSchemas(source.edit), ...EXTERNAL_SESSION_TOOLS,
  ...externalDraftSchemas(source.edit.filter((tool: { name: string }) => isExternalDraftTool(tool.name))),
  ...externalRealSchemas(source.edit)];
const catalog = [...MCP_CONTROL_TOOLS, ...tools.filter((tool) => !MCP_CONTROL_TOOLS.some((control) => control.name === tool.name)).map((tool) => ({ name: tool.name, description: tool.description,
  annotations: tool.annotations, inputSchema: { ...tool.input_schema, properties: { ...tool.input_schema.properties,
    editorProjectId: { type: 'string', description: 'Must match the project bound to this MCP transport session.' } } } }))];
if (new Set(catalog.map((tool) => tool.name)).size !== catalog.length) throw new Error('Duplicate documentation tool');
await writeFile(new URL('../public/api-tools.json', import.meta.url), JSON.stringify({
  description: 'Browser-connected MCP catalogue. Offline and progressive sessions advertise a subset; tools/list is authoritative.',
  tools: catalog,
}, null, 2) + '\n');
console.log(`${catalog.length} MCP tool contracts generated`);
