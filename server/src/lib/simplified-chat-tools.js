import { z } from 'zod';

// Explicit capability boundary for the visible simplified Helm Coach.
// Full MCP registration remains unchanged for Hermes and retained named agents.
const TASK_TOOLS = [
  'list_boards', 'get_board', 'create_board', 'rename_board', 'delete_board',
  'list_columns', 'add_column', 'rename_column', 'move_column', 'delete_column', 'clear_column',
  'list_cards', 'get_card', 'add_card', 'edit_card', 'move_card', 'delete_card',
  'list_tags', 'create_tag', 'delete_tag',
];

const HABIT_TOOLS = [
  'list_habits', 'list_today_habits', 'create_habit', 'edit_habit', 'delete_habit',
  'log_habit', 'unlog_habit', 'set_habit_outcome', 'get_habits_calendar', 'get_habit_stats',
];

const WORKOUT_TOOLS = [
  'list_exercises', 'create_exercise', 'edit_exercise', 'delete_exercise',
  'get_exercise_history', 'get_exercise_stats', 'last_session_for_exercise', 'suggest_next_session',
  'list_routines', 'create_routine', 'edit_routine', 'delete_routine',
  'add_exercise_to_routine', 'remove_exercise_from_routine',
  'start_workout', 'get_active_workout', 'end_workout', 'cancel_workout',
  'list_workouts', 'get_workout', 'add_exercise_to_workout', 'log_set', 'edit_set', 'delete_set',
];

const MEMORY_TOOLS = [
  'list_memories', 'save_memory', 'update_memory', 'delete_memory', 'recall',
];

const FOOD_TOOLS = [
  'list_today_food', 'get_food_day', 'list_food_days', 'list_meals',
  'log_meal', 'edit_meal', 'delete_meal', 'set_weight', 'log_activity',
  'get_food_targets', 'set_food_targets',
];

const COACH_TOOLS = [
  'get_vision', 'update_vision', 'mark_vision_reviewed',
  'list_goals', 'get_goal', 'add_goal', 'update_goal', 'complete_goal', 'delete_goal',
  'add_obstacle', 'delete_obstacle', 'link_goal', 'unlink_goal',
  'list_check_ins', 'log_check_in', 'get_coach_briefing',
  'get_coach_settings', 'update_coach_settings', 'update_coaching_profile',
  'notify_user',
];

export const SIMPLIFIED_CHAT_TOOL_NAMES = new Set([
  ...TASK_TOOLS,
  ...HABIT_TOOLS,
  ...WORKOUT_TOOLS,
  ...MEMORY_TOOLS,
  ...FOOD_TOOLS,
  ...COACH_TOOLS,
]);

const SIMPLIFIED_GOAL_LINK_KINDS = ['habit', 'card', 'routine', 'food_target', 'workout'];
const SIMPLIFIED_GOAL_LINK_DESCRIPTION = 'Link a goal to a reachable Helm item. kind = habit|card|routine|food_target|workout; target_id is that item id.';

function sanitizeAnthropicTool(tool) {
  if (tool.name !== 'link_goal') return tool;
  const safe = structuredClone(tool);
  safe.description = SIMPLIFIED_GOAL_LINK_DESCRIPTION;
  safe.input_schema.properties.kind.enum = [...SIMPLIFIED_GOAL_LINK_KINDS];
  return safe;
}

export function filterSimplifiedChatTools(tools) {
  return (tools || [])
    .filter((tool) => SIMPLIFIED_CHAT_TOOL_NAMES.has(tool?.name))
    .map(sanitizeAnthropicTool);
}

export function simplifiedToolServer(server) {
  return {
    registerTool(name, config, handler) {
      if (!SIMPLIFIED_CHAT_TOOL_NAMES.has(name)) return;
      if (name === 'link_goal') {
        server.registerTool(name, {
          ...config,
          description: SIMPLIFIED_GOAL_LINK_DESCRIPTION,
          inputSchema: {
            ...config.inputSchema,
            kind: z.enum(SIMPLIFIED_GOAL_LINK_KINDS),
          },
        }, handler);
        return;
      }
      server.registerTool(name, config, handler);
    },
  };
}
