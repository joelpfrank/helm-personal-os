import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAnthropicTools } from '../mcp/src/tools-anthropic.js';
import { registerTools } from '../mcp/src/tools.js';
import {
  SIMPLIFIED_CHAT_TOOL_NAMES,
  filterSimplifiedChatTools,
  simplifiedToolServer,
} from '../server/src/lib/simplified-chat-tools.js';

const REQUIRED = [
  'list_cards', 'add_card',
  'list_today_habits', 'log_habit',
  'list_today_food', 'log_meal',
  'list_routines', 'start_workout', 'log_set',
  'get_coach_briefing', 'list_goals', 'get_vision', 'list_check_ins',
  'recall', 'notify_user',
];

const FORBIDDEN_NAMES = [
  'get_calendar_status', 'list_events', 'create_event', 'get_today_schedule',
  'list_modules', 'create_module', 'list_module_items', 'add_module_item',
  'list_agents', 'create_agent', 'run_agent_now',
];

describe('simplified in-app Coach tool boundary', () => {
  it('keeps every reachable daily and Coach capability', () => {
    for (const name of REQUIRED) {
      assert.ok(SIMPLIFIED_CHAT_TOOL_NAMES.has(name), `missing ${name}`);
    }
  });

  it('excludes every hidden Calendar, module and agent capability', () => {
    for (const name of FORBIDDEN_NAMES) {
      assert.equal(SIMPLIFIED_CHAT_TOOL_NAMES.has(name), false, `hidden tool exposed: ${name}`);
    }
  });

  it('filters the actual Anthropic tool registry and its descriptions', () => {
    const filtered = filterSimplifiedChatTools(getAnthropicTools());
    const names = new Set(filtered.map((tool) => tool.name));
    for (const name of REQUIRED) assert.ok(names.has(name), `actual registry missing ${name}`);
    for (const name of FORBIDDEN_NAMES) assert.equal(names.has(name), false, `actual registry exposed ${name}`);
    assert.doesNotMatch(JSON.stringify(filtered), /Library|custom module|module item|external MCP|agent\/automation/i);
  });

  it('filters the actual SDK MCP registrations and sanitizes goal-link kinds', () => {
    const registrations = [];
    const target = { registerTool: (name, config, handler) => registrations.push({ name, config, handler }) };
    registerTools(simplifiedToolServer(target));
    const names = new Set(registrations.map((tool) => tool.name));
    for (const name of REQUIRED) assert.ok(names.has(name), `SDK registry missing ${name}`);
    for (const name of FORBIDDEN_NAMES) assert.equal(names.has(name), false, `SDK registry exposed ${name}`);
    const link = registrations.find((tool) => tool.name === 'link_goal');
    assert.equal(link.config.inputSchema.kind.safeParse('habit').success, true);
    assert.equal(link.config.inputSchema.kind.safeParse('module').success, false);
    assert.doesNotMatch(JSON.stringify(registrations.map(({ name, config }) => ({ name, description: config.description }))), /Library|custom module|module item|external MCP|agent\/automation/i);
  });
});
