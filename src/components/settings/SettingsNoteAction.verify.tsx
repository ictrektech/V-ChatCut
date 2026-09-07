import assert from 'node:assert/strict';
import { AGENT_VENDOR_PAGES_WITH_VISION } from './settingsAgentProviders';

const page = AGENT_VENDOR_PAGES_WITH_VISION.find((page) => page.key === 'llm/ictrek');
assert.ok(page?.noteAction);
assert.match(page.note ?? '', /注册账户并申请 API Token/);
assert.deepEqual(page.noteAction, {
  label: '前往 ai.ictrek.com 注册并申请 Token', href: 'https://ai.ictrek.com',
});
const anthropic = AGENT_VENDOR_PAGES_WITH_VISION.find((page) => page.key === 'llm/anthropic');
assert.equal(anthropic?.noteAction && 'action' in anthropic.noteAction && anthropic.noteAction.action, 'open-mcp-guide');
console.log('ICTrek registration entry and existing MCP action verified');
