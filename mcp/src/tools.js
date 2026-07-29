// All 19 dashboard MCP tools registered against an McpServer instance.
// Shared between the stdio entry (index.js) and the HTTP entry (http.js)
// so we have one definition of every tool.

import { z } from 'zod';
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './api.js';
import {
  resolveBoard, resolveColumn, resolveOrCreateTags, midpoint,
  resolveExercise, resolveRoutine, resolveActiveWorkout, ensureWorkoutExercise,
} from './resolve.js';

function ok(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function registerTools(server, { simplified = false } = {}) {
  // ---------- boards ----------

  server.registerTool('list_boards',
    { description: 'List all boards (id, name, position, timestamps).', inputSchema: {} },
    async () => ok(await apiGet('/boards')),
  );

  server.registerTool('get_board',
    {
      description: 'Get a single board (by id or by exact name, case-insensitive), with its columns and nested cards/tags.',
      inputSchema: {
        board_id: z.number().int().optional(),
        name: z.string().optional(),
      },
    },
    async ({ board_id, name }) => ok(await resolveBoard({ board_id, name })),
  );

  server.registerTool('create_board',
    {
      description: 'Create a new board. Returns the new board.',
      inputSchema: { name: z.string() },
    },
    async ({ name }) => ok(await apiPost('/boards', { name })),
  );

  server.registerTool('rename_board',
    {
      description: 'Rename an existing board.',
      inputSchema: { board_id: z.number().int(), name: z.string() },
    },
    async ({ board_id, name }) => ok(await apiPatch(`/boards/${board_id}`, { name })),
  );

  server.registerTool('delete_board',
    {
      description: 'Delete a board and cascade through its columns and cards.',
      inputSchema: { board_id: z.number().int() },
    },
    async ({ board_id }) => { await apiDelete(`/boards/${board_id}`); return ok({ ok: true }); },
  );

  // ---------- columns ----------

  server.registerTool('list_columns',
    {
      description: 'List columns for a board (no cards). Use get_board to also fetch cards.',
      inputSchema: { board_id: z.number().int() },
    },
    async ({ board_id }) => {
      const board = await apiGet(`/boards/${board_id}`);
      return ok(board.columns.map(({ cards, ...rest }) => rest));
    },
  );

  server.registerTool('add_column',
    {
      description: 'Add a new column to a board. position is optional; omit to append.',
      inputSchema: {
        board_id: z.number().int(),
        name: z.string(),
        position: z.number().optional(),
      },
    },
    async ({ board_id, name, position }) => {
      const body = position == null ? { name } : { name, position };
      return ok(await apiPost(`/boards/${board_id}/columns`, body));
    },
  );

  server.registerTool('rename_column',
    {
      description: 'Rename a column.',
      inputSchema: { column_id: z.number().int(), name: z.string() },
    },
    async ({ column_id, name }) => ok(await apiPatch(`/columns/${column_id}`, { name })),
  );

  server.registerTool('move_column',
    {
      description: 'Reorder a column within its board or move it to a different board. Provide either before_column_id (the column it should appear before) or after_column_id, and optionally board_id to move across boards.',
      inputSchema: {
        column_id: z.number().int(),
        before_column_id: z.number().int().optional(),
        after_column_id: z.number().int().optional(),
        board_id: z.number().int().optional(),
      },
    },
    async ({ column_id, before_column_id, after_column_id, board_id }) => {
      const patch = {};
      if (board_id != null) patch.board_id = board_id;

      if (before_column_id != null || after_column_id != null) {
        const probeBoardId = board_id ?? (await apiGet(`/columns/${column_id}`).catch(() => null))?.board_id;
        let targetBoard;
        if (probeBoardId) {
          targetBoard = await apiGet(`/boards/${probeBoardId}`);
        } else {
          const all = await apiGet('/boards');
          for (const b of all) {
            const full = await apiGet(`/boards/${b.id}`);
            if (full.columns.some((c) => c.id === column_id)) { targetBoard = full; break; }
          }
          if (!targetBoard) throw new Error('column not found in any board');
        }
        const sorted = [...targetBoard.columns].sort((a, b) => a.position - b.position);
        let prev = null, next = null;
        if (before_column_id != null) {
          const i = sorted.findIndex((c) => c.id === before_column_id);
          if (i < 0) throw new Error(`before_column_id ${before_column_id} not in target board`);
          next = sorted[i];
          prev = sorted[i - 1] || null;
        } else {
          const i = sorted.findIndex((c) => c.id === after_column_id);
          if (i < 0) throw new Error(`after_column_id ${after_column_id} not in target board`);
          prev = sorted[i];
          next = sorted[i + 1] || null;
        }
        patch.position = midpoint(prev, next);
      }
      return ok(await apiPatch(`/columns/${column_id}`, patch));
    },
  );

  server.registerTool('delete_column',
    {
      description: 'Delete a column and cascade through its cards.',
      inputSchema: { column_id: z.number().int() },
    },
    async ({ column_id }) => { await apiDelete(`/columns/${column_id}`); return ok({ ok: true }); },
  );

  server.registerTool('clear_column',
    {
      description: 'Delete every card in a column but keep the column itself. Returns the count of deleted cards. Useful when the user says "wipe my Done column" or "clear out the inbox".',
      inputSchema: { column_id: z.number().int() },
    },
    async ({ column_id }) => ok(await apiDelete(`/columns/${column_id}/cards`)),
  );

  // ---------- cards ----------

  server.registerTool('list_cards',
    {
      description: 'List cards across boards. Optional filters: board_id, column_id, tag (name), q (text search in title/notes), due_before, due_after.',
      inputSchema: {
        board_id: z.number().int().optional(),
        column_id: z.number().int().optional(),
        tag: z.string().optional(),
        q: z.string().optional(),
        due_before: z.string().optional(),
        due_after: z.string().optional(),
      },
    },
    async (args) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) {
        if (v != null && v !== '') params.set(k, String(v));
      }
      const qs = params.toString();
      return ok(await apiGet(`/cards${qs ? '?' + qs : ''}`));
    },
  );

  server.registerTool('get_card',
    {
      description: 'Get a single card by id, with tags.',
      inputSchema: { card_id: z.number().int() },
    },
    async ({ card_id }) => ok(await apiGet(`/cards/${card_id}`)),
  );

  server.registerTool('add_card',
    {
      description: 'Create a card. Provide either column_id, or board_name + column_name. tags is a list of tag names; tags not yet existing are created on the fly.',
      inputSchema: {
        column_id: z.number().int().optional(),
        board_name: z.string().optional(),
        column_name: z.string().optional(),
        title: z.string(),
        notes: z.string().optional(),
        due_date: z.string().optional(),
        color: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ column_id, board_name, column_name, title, notes, due_date, color, tags }) => {
      let resolvedColumnId = column_id;
      if (resolvedColumnId == null) {
        if (!board_name || !column_name) {
          throw new Error('provide either column_id, or board_name + column_name');
        }
        const board = await resolveBoard({ name: board_name });
        const col = await resolveColumn(board, { column_name });
        resolvedColumnId = col.id;
      }
      const tagObjs = await resolveOrCreateTags(tags);
      const body = { title };
      if (notes != null) body.notes = notes;
      if (due_date != null) body.due_date = due_date;
      if (color != null) body.color = color;
      if (tagObjs.length) body.tag_ids = tagObjs.map((t) => t.id);
      return ok(await apiPost(`/columns/${resolvedColumnId}/cards`, body));
    },
  );

  server.registerTool('edit_card',
    {
      description: 'Edit a card. tags (names) replaces the full tag set; pass [] to clear.',
      inputSchema: {
        card_id: z.number().int(),
        title: z.string().optional(),
        notes: z.string().optional(),
        due_date: z.string().nullable().optional(),
        color: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ card_id, title, notes, due_date, color, tags }) => {
      const patch = {};
      if (title != null) patch.title = title;
      if (notes != null) patch.notes = notes;
      if (due_date !== undefined) patch.due_date = due_date;
      if (color !== undefined) patch.color = color;
      if (tags !== undefined) {
        const objs = await resolveOrCreateTags(tags);
        patch.tag_ids = objs.map((t) => t.id);
      }
      return ok(await apiPatch(`/cards/${card_id}`, patch));
    },
  );

  server.registerTool('move_card',
    {
      description: 'Move a card to another column and/or another position. Provide either column_id, or column_name (+ board_name if disambiguating). For ordering within the target column, pass before_card_id OR after_card_id (the card the moving card should appear before/after); otherwise the card is appended to the end of the target column.',
      inputSchema: {
        card_id: z.number().int(),
        column_id: z.number().int().optional(),
        column_name: z.string().optional(),
        board_name: z.string().optional(),
        before_card_id: z.number().int().optional(),
        after_card_id: z.number().int().optional(),
      },
    },
    async ({ card_id, column_id, column_name, board_name, before_card_id, after_card_id }) => {
      let targetColumnId = column_id;
      let targetBoard = null;

      if (targetColumnId == null && column_name) {
        const board = board_name
          ? await resolveBoard({ name: board_name })
          : null;
        if (board) {
          const col = await resolveColumn(board, { column_name });
          targetColumnId = col.id;
          targetBoard = board;
        } else {
          const all = await apiGet('/boards');
          const matches = [];
          for (const b of all) {
            const full = await apiGet(`/boards/${b.id}`);
            for (const c of full.columns) {
              if (c.name.toLowerCase() === column_name.toLowerCase()) matches.push({ col: c, board: full });
            }
          }
          if (matches.length === 0) throw new Error(`column "${column_name}" not found`);
          if (matches.length > 1) {
            const ids = matches.map((m) => `column ${m.col.id} (board "${m.board.name}")`).join(', ');
            throw new Error(`ambiguous_name: column "${column_name}" exists in multiple boards: ${ids}. Pass board_name to disambiguate.`);
          }
          targetColumnId = matches[0].col.id;
          targetBoard = matches[0].board;
        }
      }

      const patch = {};
      if (targetColumnId != null) patch.column_id = targetColumnId;

      if (before_card_id != null || after_card_id != null || (targetColumnId != null)) {
        if (!targetBoard) {
          const all = await apiGet('/boards');
          outer: for (const b of all) {
            const full = await apiGet(`/boards/${b.id}`);
            if (full.columns.some((c) => c.id === (targetColumnId ?? -1))) {
              targetBoard = full; break;
            }
            for (const col of full.columns) {
              if (col.cards.some((c) => c.id === card_id) && targetColumnId == null) {
                targetBoard = full; targetColumnId = col.id; patch.column_id = col.id; break outer;
              }
            }
          }
        }
        const col = targetBoard.columns.find((c) => c.id === targetColumnId);
        if (!col) throw new Error('target column not resolved');
        const others = col.cards.filter((c) => c.id !== card_id);
        const sorted = [...others].sort((a, b) => a.position - b.position);
        let prev = null, next = null;
        if (before_card_id != null) {
          const i = sorted.findIndex((c) => c.id === before_card_id);
          if (i < 0) throw new Error(`before_card_id ${before_card_id} not in target column`);
          next = sorted[i];
          prev = sorted[i - 1] || null;
        } else if (after_card_id != null) {
          const i = sorted.findIndex((c) => c.id === after_card_id);
          if (i < 0) throw new Error(`after_card_id ${after_card_id} not in target column`);
          prev = sorted[i];
          next = sorted[i + 1] || null;
        } else {
          prev = sorted[sorted.length - 1] || null;
          next = null;
        }
        patch.position = midpoint(prev, next);
      }

      return ok(await apiPatch(`/cards/${card_id}`, patch));
    },
  );

  server.registerTool('delete_card',
    {
      description: 'Delete a card.',
      inputSchema: { card_id: z.number().int() },
    },
    async ({ card_id }) => { await apiDelete(`/cards/${card_id}`); return ok({ ok: true }); },
  );

  // ---------- tags ----------

  server.registerTool('list_tags',
    { description: 'List all tags.', inputSchema: {} },
    async () => ok(await apiGet('/tags')),
  );

  server.registerTool('create_tag',
    {
      description: 'Create a new tag. color is optional hex #RRGGBB; defaults to gray. Conflicts return an error.',
      inputSchema: { name: z.string(), color: z.string().optional() },
    },
    async ({ name, color }) => ok(await apiPost('/tags', color ? { name, color } : { name })),
  );

  server.registerTool('delete_tag',
    {
      description: 'Delete a tag (also detaches it from all cards).',
      inputSchema: { tag_id: z.number().int() },
    },
    async ({ tag_id }) => { await apiDelete(`/tags/${tag_id}`); return ok({ ok: true }); },
  );

  // ---------- habits ----------

  async function resolveHabit({ habit_id, habit_name }) {
    if (habit_id != null) return apiGet(`/habits/${habit_id}`);
    if (!habit_name) throw new Error('either habit_id or habit_name required');
    const all = await apiGet('/habits');
    const matches = all.filter((h) => h.name.toLowerCase() === habit_name.toLowerCase());
    if (matches.length === 0) {
      const e = new Error(`habit "${habit_name}" not found`);
      e.code = 'not_found';
      throw e;
    }
    if (matches.length > 1) {
      const e = new Error(`ambiguous_name: ${matches.length} habits match "${habit_name}"`);
      e.code = 'ambiguous_name';
      throw e;
    }
    return matches[0];
  }

  server.registerTool('list_habits',
    {
      description: 'List all active habits. Pass include_archived=true to also see archived ones.',
      inputSchema: { include_archived: z.boolean().optional() },
    },
    async ({ include_archived }) => {
      const qs = include_archived ? '?include=archived' : '';
      return ok(await apiGet(`/habits${qs}`));
    },
  );

  server.registerTool('list_today_habits',
    {
      description: 'List habits scheduled for today with their progress and tri-state outcome. Each habit includes today_quantity, progress 0..1, completed, outcome ("success" | "failed" | null for an explicit mark), and effective_status ("success" | "failed" | "unspecified"). effective_status is the source of truth: an explicit outcome wins, otherwise it is derived from quantity (success when the goal is met, else unspecified — a blank day is NOT a failure). Use this when the user asks "what habits do I have today?" or "am I done with my habits?".',
      inputSchema: {},
    },
    async () => ok(await apiGet('/habits/today')),
  );

  server.registerTool('create_habit',
    {
      description: 'Create a new habit. days_of_week is a CSV of ISO day numbers (1=Mon…7=Sun); omit for daily. goal_quantity is how many units count as completing one day (defaults to 1). unit is freeform ("min", "glass", "page") — leave blank for simple yes/no habits. time_of_day organizes the habit into a part of the day (defaults to anytime). category is a freeform life area ("Health", "Work", "Relationships"…, max 50 chars) used to group habits — reuse the user\'s existing category names when they fit.',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        color: z.string().optional(),
        goal_quantity: z.number().optional(),
        unit: z.string().optional(),
        days_of_week: z.string().optional(),
        time_of_day: z.enum(['morning', 'afternoon', 'evening', 'night', 'anytime']).optional(),
        category: z.string().optional(),
      },
    },
    async (args) => {
      const body = {};
      for (const k of ['name', 'description', 'color', 'goal_quantity', 'unit', 'days_of_week', 'time_of_day', 'category']) {
        if (args[k] !== undefined && args[k] !== null) body[k] = args[k];
      }
      return ok(await apiPost('/habits', body));
    },
  );

  server.registerTool('edit_habit',
    {
      description: 'Edit an existing habit (rename, change schedule, change goal, reorganize, etc.). time_of_day moves it to a part of the day (anytime = unscheduled); category assigns a freeform life area ("" clears it). Pass archived=true/false to archive or restore.',
      inputSchema: {
        habit_id: z.number().int().optional(),
        habit_name: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        color: z.string().nullable().optional(),
        goal_quantity: z.number().optional(),
        unit: z.string().optional(),
        days_of_week: z.string().optional(),
        time_of_day: z.enum(['morning', 'afternoon', 'evening', 'night', 'anytime']).optional(),
        category: z.string().optional(),
        archived: z.boolean().optional(),
      },
    },
    async ({ habit_id, habit_name, ...patch }) => {
      const habit = await resolveHabit({ habit_id, habit_name });
      const body = {};
      for (const k of Object.keys(patch)) {
        if (patch[k] !== undefined) body[k] = patch[k];
      }
      return ok(await apiPatch(`/habits/${habit.id}`, body));
    },
  );

  server.registerTool('delete_habit',
    {
      description: 'Permanently delete a habit AND all its logs. Prefer edit_habit { archived: true } if you want to stop tracking but keep history.',
      inputSchema: {
        habit_id: z.number().int().optional(),
        habit_name: z.string().optional(),
      },
    },
    async ({ habit_id, habit_name }) => {
      const habit = await resolveHabit({ habit_id, habit_name });
      await apiDelete(`/habits/${habit.id}`);
      return ok({ ok: true });
    },
  );

  server.registerTool('log_habit',
    {
      description: 'Record a habit completion. Quantity defaults to 1 (use this even for goal>1 habits — multiple log calls accumulate). Date defaults to today (use YYYY-MM-DD for backdating).',
      inputSchema: {
        habit_id: z.number().int().optional(),
        habit_name: z.string().optional(),
        quantity: z.number().optional(),
        date: z.string().optional(),
        note: z.string().optional(),
      },
    },
    async ({ habit_id, habit_name, quantity, date, note }) => {
      const habit = await resolveHabit({ habit_id, habit_name });
      const body = {};
      if (quantity !== undefined) body.quantity = quantity;
      if (date !== undefined) body.date = date;
      if (note !== undefined) body.note = note;
      return ok(await apiPost(`/habits/${habit.id}/log`, body));
    },
  );

  server.registerTool('unlog_habit',
    {
      description: 'Undo the most recent log for a habit on a given date (defaults to today). Use this when the user says they accidentally logged something or didn\'t actually do it. If multiple logs exist for the date, this only undoes the most recent one — call again to undo more.',
      inputSchema: {
        habit_id: z.number().int().optional(),
        habit_name: z.string().optional(),
        date: z.string().optional(),
      },
    },
    async ({ habit_id, habit_name, date }) => {
      const habit = await resolveHabit({ habit_id, habit_name });
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      const qs = params.toString();
      return ok(await apiDelete(`/habits/${habit.id}/log/last${qs ? '?' + qs : ''}`));
    },
  );

  server.registerTool('set_habit_outcome',
    {
      description: 'Mark whether a habit was Achieved or Not achieved on a day, or clear it back to Unspecified. status="success" = Achieved, status="failed" = Not achieved (did not do it), status="unspecified" = clear the explicit mark (a blank day is NOT a failure — it just has no judgement yet). An explicit success/failed OVERRIDES the quantity-derived status; clearing reverts to the quantity-derived status. This is separate from log_habit: use log_habit to record how much was done (quantity), and this tool to set the yes/no judgement. Date defaults to today (YYYY-MM-DD to backdate). Use this when the user says things like "I did X", "mark X done", "I failed X today", "I skipped/missed X", or "clear X for today".',
      inputSchema: {
        habit_id: z.number().int().optional(),
        habit_name: z.string().optional(),
        status: z.enum(['success', 'failed', 'unspecified']),
        date: z.string().optional(),
      },
    },
    async ({ habit_id, habit_name, status, date }) => {
      const habit = await resolveHabit({ habit_id, habit_name });
      if (status === 'unspecified') {
        const qs = date ? `?date=${encodeURIComponent(date)}` : '';
        return ok(await apiDelete(`/habits/${habit.id}/outcome${qs}`));
      }
      const body = { status };
      if (date) body.date = date;
      return ok(await apiPut(`/habits/${habit.id}/outcome`, body));
    },
  );

  server.registerTool('get_habits_calendar',
    {
      description: 'Macro view across all active habits over a date range. Returns a habits × days grid; each cell has scheduled, quantity, ratio, outcome ("success" | "failed" | null), effective_status ("success" | "failed" | "unspecified"), and met (true only when effective_status is success). A blank scheduled day is "unspecified", NOT a miss. Defaults to the last 30 days. Use this when the user wants a broad "how am I doing across everything" view.',
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
      },
    },
    async ({ from, to }) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      return ok(await apiGet(`/habits/calendar${qs ? '?' + qs : ''}`));
    },
  );

  server.registerTool('get_habit_stats',
    {
      description: 'Get streak, longest streak, completion %, and a 90-day heatmap for a habit. Returns success_days, failed_days, unspecified_days, resolved_days (= success + failed) and completion_rate = success / resolved, so genuinely blank (unspecified) days are NOT counted as failures. met_days stays for backward compatibility (= success_days). Each heatmap cell carries outcome and effective_status. Use this when the user asks "how is my X going?" or "what is my streak?".',
      inputSchema: {
        habit_id: z.number().int().optional(),
        habit_name: z.string().optional(),
      },
    },
    async ({ habit_id, habit_name }) => {
      const habit = await resolveHabit({ habit_id, habit_name });
      return ok(await apiGet(`/habits/${habit.id}/stats`));
    },
  );

  // ---------- workouts: exercises catalog ----------

  server.registerTool('list_exercises',
    {
      description: 'List exercises in the catalog. Optional q (substring on name/muscle), kind ("lifting"|"cardio"), include_archived.',
      inputSchema: {
        q: z.string().optional(),
        kind: z.enum(['lifting', 'cardio']).optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async ({ q, kind, include_archived }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (kind) params.set('kind', kind);
      if (include_archived) params.set('include', 'archived');
      const qs = params.toString();
      return ok(await apiGet(`/exercises${qs ? '?' + qs : ''}`));
    },
  );

  server.registerTool('create_exercise',
    {
      description: 'Create an exercise. kind defaults to "lifting"; pass "cardio" for run/bike/row where sets carry time+distance instead of weight×reps.',
      inputSchema: {
        name: z.string(),
        kind: z.enum(['lifting', 'cardio']).optional(),
        muscle_group: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      const body = {};
      for (const k of ['name', 'kind', 'muscle_group', 'notes']) {
        if (args[k] !== undefined) body[k] = args[k];
      }
      return ok(await apiPost('/exercises', body));
    },
  );

  server.registerTool('edit_exercise',
    {
      description: 'Rename, recategorize, or archive an exercise.',
      inputSchema: {
        exercise_id: z.number().int().optional(),
        exercise_name: z.string().optional(),
        name: z.string().optional(),
        kind: z.enum(['lifting', 'cardio']).optional(),
        muscle_group: z.string().optional(),
        notes: z.string().optional(),
        archived: z.boolean().optional(),
      },
    },
    async ({ exercise_id, exercise_name, ...patch }) => {
      const ex = await resolveExercise({ exercise_id, exercise_name });
      const body = {};
      for (const k of Object.keys(patch)) if (patch[k] !== undefined) body[k] = patch[k];
      return ok(await apiPatch(`/exercises/${ex.id}`, body));
    },
  );

  server.registerTool('delete_exercise',
    {
      description: 'Permanently delete an exercise. Fails with 409 if used in any past workout or routine — prefer edit_exercise { archived: true } to keep history.',
      inputSchema: {
        exercise_id: z.number().int().optional(),
        exercise_name: z.string().optional(),
      },
    },
    async ({ exercise_id, exercise_name }) => {
      const ex = await resolveExercise({ exercise_id, exercise_name });
      await apiDelete(`/exercises/${ex.id}`);
      return ok({ ok: true });
    },
  );

  server.registerTool('get_exercise_history',
    {
      description: 'List recent sessions where this exercise was performed, each with its sets. Use for "what did I do last time on bench?".',
      inputSchema: {
        exercise_id: z.number().int().optional(),
        exercise_name: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().optional(),
      },
    },
    async ({ exercise_id, exercise_name, from, to, limit }) => {
      const ex = await resolveExercise({ exercise_id, exercise_name });
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (limit) params.set('limit', String(limit));
      const qs = params.toString();
      return ok(await apiGet(`/exercises/${ex.id}/history${qs ? '?' + qs : ''}`));
    },
  );

  server.registerTool('get_exercise_stats',
    {
      description: 'PR (e1RM, heaviest set, best volume), session summaries, and a progression suggestion for this exercise. Use for "what is my bench PR?" / "how am I progressing?" / "what should I do today?".',
      inputSchema: {
        exercise_id: z.number().int().optional(),
        exercise_name: z.string().optional(),
        days: z.number().int().optional(),
      },
    },
    async ({ exercise_id, exercise_name, days }) => {
      const ex = await resolveExercise({ exercise_id, exercise_name });
      const params = new URLSearchParams();
      if (days) params.set('days', String(days));
      const qs = params.toString();
      return ok(await apiGet(`/exercises/${ex.id}/stats${qs ? '?' + qs : ''}`));
    },
  );

  server.registerTool('last_session_for_exercise',
    {
      description: 'Just the most recent session for this exercise (date + sets). Shortcut for the common "what did I do last time?" question.',
      inputSchema: {
        exercise_id: z.number().int().optional(),
        exercise_name: z.string().optional(),
      },
    },
    async ({ exercise_id, exercise_name }) => {
      const ex = await resolveExercise({ exercise_id, exercise_name });
      const r = await apiGet(`/exercises/${ex.id}/history?limit=1`);
      return ok({ exercise: ex, last_session: r.sessions[0] || null });
    },
  );

  server.registerTool('suggest_next_session',
    {
      description: 'Recommend weight/reps for the next session of a lifting exercise based on the last session\'s top set and RPE. Returns the suggestion plus the last session\'s details.',
      inputSchema: {
        exercise_id: z.number().int().optional(),
        exercise_name: z.string().optional(),
      },
    },
    async ({ exercise_id, exercise_name }) => {
      const ex = await resolveExercise({ exercise_id, exercise_name });
      const stats = await apiGet(`/exercises/${ex.id}/stats`);
      return ok({ exercise: ex, last_session: stats.last_session, suggestion: stats.suggestion });
    },
  );

  // ---------- workouts: routines ----------

  server.registerTool('list_routines',
    {
      description: 'List workout routines (templates), each with its embedded exercise targets.',
      inputSchema: { include_archived: z.boolean().optional() },
    },
    async ({ include_archived }) => {
      const qs = include_archived ? '?include=archived' : '';
      return ok(await apiGet(`/routines${qs}`));
    },
  );

  server.registerTool('create_routine',
    {
      description: 'Create a routine. Provide exercises[] with exercise_name (resolved to id) and optional targets (target_sets, target_reps, target_weight, target_time_seconds, target_distance_m).',
      inputSchema: {
        name: z.string(),
        notes: z.string().optional(),
        exercises: z.array(z.object({
          exercise_name: z.string(),
          target_sets: z.number().int().optional(),
          target_reps: z.number().int().optional(),
          target_weight: z.number().optional(),
          target_time_seconds: z.number().int().optional(),
          target_distance_m: z.number().optional(),
          notes: z.string().optional(),
        })).optional(),
      },
    },
    async ({ name, notes, exercises }) => {
      const seeds = [];
      if (exercises?.length) {
        for (const e of exercises) {
          const ex = await resolveExercise({ exercise_name: e.exercise_name });
          seeds.push({
            exercise_id: ex.id,
            target_sets: e.target_sets,
            target_reps: e.target_reps,
            target_weight: e.target_weight,
            target_time_seconds: e.target_time_seconds,
            target_distance_m: e.target_distance_m,
            notes: e.notes,
          });
        }
      }
      const body = { name };
      if (notes != null) body.notes = notes;
      if (seeds.length) body.exercises = seeds;
      return ok(await apiPost('/routines', body));
    },
  );

  server.registerTool('edit_routine',
    {
      description: 'Edit a routine (rename, change notes, archive).',
      inputSchema: {
        routine_id: z.number().int().optional(),
        routine_name: z.string().optional(),
        name: z.string().optional(),
        notes: z.string().optional(),
        archived: z.boolean().optional(),
      },
    },
    async ({ routine_id, routine_name, ...patch }) => {
      const r = await resolveRoutine({ routine_id, routine_name });
      const body = {};
      for (const k of Object.keys(patch)) if (patch[k] !== undefined) body[k] = patch[k];
      return ok(await apiPatch(`/routines/${r.id}`, body));
    },
  );

  server.registerTool('delete_routine',
    {
      description: 'Delete a routine. Past workouts that used this routine keep their data; their routine_id is set to null.',
      inputSchema: {
        routine_id: z.number().int().optional(),
        routine_name: z.string().optional(),
      },
    },
    async ({ routine_id, routine_name }) => {
      const r = await resolveRoutine({ routine_id, routine_name });
      await apiDelete(`/routines/${r.id}`);
      return ok({ ok: true });
    },
  );

  server.registerTool('add_exercise_to_routine',
    {
      description: 'Append an exercise to a routine with optional targets.',
      inputSchema: {
        routine_id: z.number().int().optional(),
        routine_name: z.string().optional(),
        exercise_name: z.string(),
        target_sets: z.number().int().optional(),
        target_reps: z.number().int().optional(),
        target_weight: z.number().optional(),
        target_time_seconds: z.number().int().optional(),
        target_distance_m: z.number().optional(),
        notes: z.string().optional(),
      },
    },
    async ({ routine_id, routine_name, exercise_name, ...targets }) => {
      const r = await resolveRoutine({ routine_id, routine_name });
      const ex = await resolveExercise({ exercise_name });
      const body = { exercise_id: ex.id };
      for (const k of Object.keys(targets)) if (targets[k] !== undefined) body[k] = targets[k];
      return ok(await apiPost(`/routines/${r.id}/exercises`, body));
    },
  );

  server.registerTool('remove_exercise_from_routine',
    {
      description: 'Remove an exercise from a routine (by exercise name within that routine).',
      inputSchema: {
        routine_id: z.number().int().optional(),
        routine_name: z.string().optional(),
        exercise_name: z.string(),
      },
    },
    async ({ routine_id, routine_name, exercise_name }) => {
      const r = await resolveRoutine({ routine_id, routine_name });
      const ex = await resolveExercise({ exercise_name });
      const re = (r.exercises || []).find((x) => x.exercise_id === ex.id);
      if (!re) {
        const e = new Error(`exercise "${exercise_name}" not in routine "${r.name}"`);
        e.code = 'not_found';
        throw e;
      }
      await apiDelete(`/routines/exercise/${re.id}`);
      return ok({ ok: true });
    },
  );

  // ---------- workouts: lifecycle ----------

  server.registerTool('start_workout',
    {
      description: 'Begin a new workout. Optionally pass routine_name to seed workout_exercises and empty sets from a routine. Fails 409 if a workout is already active — call end_workout or cancel_workout first.',
      inputSchema: {
        name: z.string().optional(),
        routine_name: z.string().optional(),
      },
    },
    async ({ name, routine_name }) => {
      const body = {};
      if (name) body.name = name;
      if (routine_name) {
        const r = await resolveRoutine({ routine_name });
        body.routine_id = r.id;
      }
      return ok(await apiPost('/workouts', body));
    },
  );

  server.registerTool('get_active_workout',
    {
      description: 'Return the current in-progress workout (with exercises and sets), or null if there isn\'t one.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await apiGet('/workouts/active'));
      } catch (err) {
        if (err.code === 'not_found') return ok(null);
        throw err;
      }
    },
  );

  server.registerTool('end_workout',
    {
      description: 'Mark the active workout as finished (sets ended_at = now). Optional notes for the workout overall.',
      inputSchema: { notes: z.string().optional() },
    },
    async ({ notes }) => {
      const w = await resolveActiveWorkout();
      const body = {};
      if (notes != null) body.notes = notes;
      return ok(await apiPost(`/workouts/${w.id}/end`, body));
    },
  );

  server.registerTool('cancel_workout',
    {
      description: 'Discard the active workout entirely (deletes it and all its sets). Use when the user says they never actually started.',
      inputSchema: {},
    },
    async () => {
      const w = await resolveActiveWorkout();
      await apiDelete(`/workouts/${w.id}`);
      return ok({ ok: true });
    },
  );

  server.registerTool('list_workouts',
    {
      description: 'List past workouts in a date range (started_at-based). No nested sets — use get_workout for details.',
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().optional(),
      },
    },
    async ({ from, to, limit }) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (limit) params.set('limit', String(limit));
      const qs = params.toString();
      return ok(await apiGet(`/workouts${qs ? '?' + qs : ''}`));
    },
  );

  server.registerTool('get_workout',
    {
      description: 'Full workout (with exercises and sets) by id.',
      inputSchema: { workout_id: z.number().int() },
    },
    async ({ workout_id }) => ok(await apiGet(`/workouts/${workout_id}`)),
  );

  server.registerTool('add_exercise_to_workout',
    {
      description: 'Add an exercise to a workout (defaults to the active one).',
      inputSchema: {
        exercise_name: z.string(),
        workout_id: z.number().int().optional(),
      },
    },
    async ({ exercise_name, workout_id }) => {
      const ex = await resolveExercise({ exercise_name });
      let wId = workout_id;
      if (wId == null) {
        const w = await resolveActiveWorkout();
        wId = w.id;
      }
      return ok(await apiPost(`/workouts/${wId}/exercises`, { exercise_id: ex.id }));
    },
  );

  server.registerTool('log_set',
    {
      description: 'Hot path: log a completed set in the active workout. Specify the exercise by name; the tool finds (or creates) the workout_exercise. For lifting: weight_kg + reps (+ optional rpe, is_warmup). For cardio: time_seconds + distance_m. Defaults to completed=true. Returns the new Set including its id (quote it back for follow-ups like "edit that to RPE 8").',
      inputSchema: {
        exercise_name: z.string(),
        weight_kg: z.number().optional(),
        reps: z.number().int().optional(),
        time_seconds: z.number().int().optional(),
        distance_m: z.number().optional(),
        rpe: z.number().optional(),
        is_warmup: z.boolean().optional(),
        completed: z.boolean().optional(),
        note: z.string().optional(),
      },
    },
    async (args) => {
      const ex = await resolveExercise({ exercise_name: args.exercise_name });
      const active = await resolveActiveWorkout();
      const we = await ensureWorkoutExercise(active, ex.id);
      const body = {};
      if (ex.kind === 'lifting') {
        if (args.weight_kg !== undefined) body.weight_kg = args.weight_kg;
        if (args.reps !== undefined) body.reps = args.reps;
      } else {
        if (args.time_seconds !== undefined) body.time_seconds = args.time_seconds;
        if (args.distance_m !== undefined) body.distance_m = args.distance_m;
      }
      if (args.rpe !== undefined) body.rpe = args.rpe;
      if (args.is_warmup !== undefined) body.is_warmup = args.is_warmup;
      body.completed = args.completed !== false;
      if (args.note !== undefined) body.note = args.note;
      return ok(await apiPost(`/workouts/exercise/${we.id}/sets`, body));
    },
  );

  server.registerTool('edit_set',
    {
      description: 'Edit a set by id (typically the one returned by log_set). Pass only the fields you want to change.',
      inputSchema: {
        set_id: z.number().int(),
        weight_kg: z.number().optional(),
        reps: z.number().int().optional(),
        time_seconds: z.number().int().optional(),
        distance_m: z.number().optional(),
        rpe: z.number().nullable().optional(),
        is_warmup: z.boolean().optional(),
        completed: z.boolean().optional(),
        note: z.string().optional(),
      },
    },
    async ({ set_id, ...patch }) => {
      const body = {};
      for (const k of Object.keys(patch)) if (patch[k] !== undefined) body[k] = patch[k];
      return ok(await apiPatch(`/workouts/sets/${set_id}`, body));
    },
  );

  server.registerTool('delete_set',
    {
      description: 'Delete a set by id.',
      inputSchema: { set_id: z.number().int() },
    },
    async ({ set_id }) => { await apiDelete(`/workouts/sets/${set_id}`); return ok({ ok: true }); },
  );

  // ---------- calendar ----------

  server.registerTool('get_calendar_status',
    {
      description: 'Check whether the Google Calendar integration is configured + authorized. Returns the connected email, calendar id, last sync time, and any sync error. Useful for debugging "Claude can\'t see my events".',
      inputSchema: {},
    },
    async () => ok(await apiGet('/calendar/status')),
  );

  server.registerTool('sync_calendar',
    {
      description: 'Force an incremental Google Calendar sync now (instead of waiting up to 5 minutes for the next scheduled sync). Useful right after the user edits an event in Apple Calendar and asks you about it.',
      inputSchema: {},
    },
    async () => ok(await apiPost('/calendar/sync', {})),
  );

  server.registerTool('list_events',
    {
      description: 'List events in a date range. Defaults to "today through 7 days from now". Dates are ISO 8601 strings (timezone allowed). Excludes cancelled events.',
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
      },
    },
    async ({ from, to }) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      return ok(await apiGet(`/calendar/events${qs ? '?' + qs : ''}`));
    },
  );

  server.registerTool('get_event',
    {
      description: 'Get a single calendar event by its local id (use the id from list_events). Returns the full event including the Google event id and the html_link to view in Google Calendar UI.',
      inputSchema: { event_id: z.number().int() },
    },
    async ({ event_id }) => ok(await apiGet(`/calendar/events/${event_id}`)),
  );

  server.registerTool('create_event',
    {
      description: 'Create a calendar event. Writes to Google Calendar first; the change syncs to Apple Calendar via the connected Google account. start_at and end_at are ISO 8601 datetimes (e.g. "2026-05-14T14:30:00-07:00"). Omit end_at to default to start_at + 1h (or +1 day for all-day events). Set all_day=true for all-day events; when true, use the date portion (YYYY-MM-DD) of start_at and end_at.',
      inputSchema: {
        summary: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        start_at: z.string(),
        end_at: z.string().optional(),
        all_day: z.boolean().optional(),
      },
    },
    async (args) => {
      const body = { summary: args.summary, start_at: args.start_at };
      if (args.description != null) body.description = args.description;
      if (args.location != null) body.location = args.location;
      if (args.end_at != null) body.end_at = args.end_at;
      if (args.all_day != null) body.all_day = args.all_day;
      return ok(await apiPost('/calendar/events', body));
    },
  );

  server.registerTool('update_event',
    {
      description: 'Edit a calendar event (rename, move, change duration, etc.). Pass event_id from a previous list_events / get_event / create_event response, plus only the fields you want to change.',
      inputSchema: {
        event_id: z.number().int(),
        summary: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        start_at: z.string().optional(),
        end_at: z.string().optional(),
        all_day: z.boolean().optional(),
      },
    },
    async ({ event_id, ...patch }) => {
      const body = {};
      for (const k of Object.keys(patch)) if (patch[k] !== undefined) body[k] = patch[k];
      return ok(await apiPatch(`/calendar/events/${event_id}`, body));
    },
  );

  server.registerTool('delete_event',
    {
      description: 'Delete a calendar event. Writes the deletion to Google → propagates to Apple Calendar.',
      inputSchema: { event_id: z.number().int() },
    },
    async ({ event_id }) => { await apiDelete(`/calendar/events/${event_id}`); return ok({ ok: true }); },
  );

  server.registerTool('find_free_slot',
    {
      description: 'Find open slots of at least `duration_minutes` between `from` and `to`, considering existing events. Defaults to 30-minute slots inside a 9am–6pm workday. Returns up to 20 slots in order. Use this when the user asks "when am I free this week?" or "schedule a 45-minute call this afternoon".',
      inputSchema: {
        from: z.string(),
        to: z.string(),
        duration_minutes: z.number().int().optional(),
        workday_start: z.string().optional(),
        workday_end: z.string().optional(),
      },
    },
    async ({ from, to, duration_minutes, workday_start, workday_end }) => {
      const body = { from, to };
      if (duration_minutes != null) body.duration_minutes = duration_minutes;
      if (workday_start != null) body.workday_start = workday_start;
      if (workday_end != null) body.workday_end = workday_end;
      return ok(await apiPost('/calendar/find_free_slot', body));
    },
  );

  server.registerTool('get_today_schedule',
    {
      description: 'A unified "today" view across the dashboard: calendar events scheduled today, kanban cards with a due date of today (or overdue), and the day\'s scheduled habits with completion status. Use this when the user asks "what does my day look like?" or "what should I focus on today?".',
      inputSchema: {},
    },
    async () => {
      const now = new Date();
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now);   end.setHours(23, 59, 59, 999);
      const startIso = start.toISOString();
      const endIso = end.toISOString();
      const tomorrowIso = new Date(end.getTime() + 1000).toISOString();

      const [events, habitToday, overdueCards, todayCards] = await Promise.all([
        apiGet(`/calendar/events?from=${startIso}&to=${endIso}`).catch(() => []),
        apiGet('/habits/today').catch(() => ({ habits: [] })),
        apiGet(`/cards?due_before=${startIso}`).catch(() => []),
        apiGet(`/cards?due_after=${startIso}&due_before=${tomorrowIso}`).catch(() => []),
      ]);

      return ok({
        date: startIso.slice(0, 10),
        calendar: {
          events: events.map((e) => ({
            id: e.id,
            summary: e.summary,
            start_at: e.start_at,
            end_at: e.end_at,
            all_day: !!e.all_day,
            location: e.location || null,
          })),
          count: events.length,
        },
        habits: {
          scheduled: habitToday.habits || [],
          done: (habitToday.habits || []).filter((h) => h.completed).length,
          total: (habitToday.habits || []).length,
        },
        tasks: {
          overdue: overdueCards.map((c) => ({ id: c.id, title: c.title, due_date: c.due_date, column_id: c.column_id })),
          due_today: todayCards.map((c) => ({ id: c.id, title: c.title, due_date: c.due_date, column_id: c.column_id })),
        },
      });
    },
  );

  // ---------- memory ----------

  server.registerTool('list_memories',
    {
      description: 'List all long-term memories the assistant has stored about the user. (Note: in the in-dashboard chat these are already loaded into your context — calling this is only necessary if you suspect the bank changed externally.)',
      inputSchema: {},
    },
    async () => ok(await apiGet('/memories')),
  );

  server.registerTool('save_memory',
    {
      description: 'Save a new durable fact about the user. Use for preferences, ongoing projects, relationships, work context, recurring needs — NOT ephemeral chat context. If you are updating an existing memory, use update_memory instead so you don\'t create a duplicate.',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ok(await apiPost('/memories', { text })),
  );

  server.registerTool('update_memory',
    {
      description: 'Revise an existing memory by id (e.g. when something has changed about the user that contradicts what was previously stored). Replaces the full text — read the existing one first if you only want to amend.',
      inputSchema: { memory_id: z.number().int(), text: z.string() },
    },
    async ({ memory_id, text }) => ok(await apiPatch(`/memories/${memory_id}`, { text })),
  );

  server.registerTool('delete_memory',
    {
      description: 'Permanently delete a memory by id. Use when the stored fact is no longer true (project ended, role changed, etc.) and there is nothing to replace it with.',
      inputSchema: { memory_id: z.number().int() },
    },
    async ({ memory_id }) => { await apiDelete(`/memories/${memory_id}`); return ok({ ok: true }); },
  );

  server.registerTool('recall',
    {
      description: 'Search the user\'s available history — past conversations, check-ins/reflections, and saved memories — for anything matching a query. Use this when the user refers to something from before ("what did I say about…", "when did I last…", "remember when…") or when you need context you don\'t already have loaded. Returns dated snippets tagged with their source.',
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const scope = simplified ? '&scope=core' : '';
      return ok(await apiGet(`/memories/recall?q=${encodeURIComponent(query)}${scope}`));
    },
  );

  // ---------- Food diary ----------

  server.registerTool('list_today_food',
    {
      description: 'Get today\'s food picture: weight, activity, all meals, macro totals (calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, flagged count), and an auto-computed health score (0-100). Use when the user asks "what have I eaten today?", "how am I doing?", or "what\'s my macros?".',
      inputSchema: {},
    },
    async () => ok(await apiGet('/food/today')),
  );

  server.registerTool('get_food_day',
    {
      description: 'Get the food picture for a specific date (YYYY-MM-DD). Same shape as list_today_food.',
      inputSchema: { date: z.string() },
    },
    async ({ date }) => ok(await apiGet(`/food/days/${encodeURIComponent(date)}`)),
  );

  server.registerTool('list_food_days',
    {
      description: 'Per-day totals (calories, macros, flagged, score) across a date range. Use for weekly/monthly summaries.',
      inputSchema: { from: z.string(), to: z.string() },
    },
    async ({ from, to }) => ok(await apiGet(`/food/days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)),
  );

  server.registerTool('list_meals',
    {
      description: 'List meal entries. Pass `date` for one day, or `from`+`to` for a range. Use when the user asks "what did I eat on X?".',
      inputSchema: {
        date: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
    },
    async ({ date, from, to }) => {
      const qs = new URLSearchParams();
      if (date) qs.set('date', date);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      return ok(await apiGet(`/food/meals${qs.toString() ? '?' + qs.toString() : ''}`));
    },
  );

  server.registerTool('log_meal',
    {
      description: 'Log a meal/snack/drink from a casual description. Estimate calories and macros from common nutrition data — do NOT ask the user to look anything up; rough numbers are the whole point. Set processed=true for fast food, packaged snacks, soda, candy, processed meats, refined-flour breads. Set added_sugar=true for soda, candy, sweetened yogurt, baked goods. Set organic=true only if the user explicitly says it was organic. Defaults: date=today, meal_type="meal".',
      inputSchema: {
        name: z.string(),
        date: z.string().optional(),
        meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'meal']).optional(),
        calories: z.number().int().optional(),
        protein_g: z.number().optional(),
        carbs_g: z.number().optional(),
        fat_g: z.number().optional(),
        fiber_g: z.number().optional(),
        sugar_g: z.number().optional(),
        processed: z.boolean().optional(),
        organic: z.boolean().optional(),
        added_sugar: z.boolean().optional(),
        notes: z.string().optional(),
      },
    },
    async (input) => ok(await apiPost('/food/meals', input)),
  );

  server.registerTool('edit_meal',
    {
      description: 'Edit any field of an existing meal by id. Pass only the fields to change.',
      inputSchema: {
        meal_id: z.number().int(),
        name: z.string().optional(),
        date: z.string().optional(),
        meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'meal']).optional(),
        calories: z.number().int().optional(),
        protein_g: z.number().optional(),
        carbs_g: z.number().optional(),
        fat_g: z.number().optional(),
        fiber_g: z.number().optional(),
        sugar_g: z.number().optional(),
        processed: z.boolean().optional(),
        organic: z.boolean().optional(),
        added_sugar: z.boolean().optional(),
        notes: z.string().optional(),
      },
    },
    async ({ meal_id, ...patch }) => ok(await apiPatch(`/food/meals/${meal_id}`, patch)),
  );

  server.registerTool('delete_meal',
    {
      description: 'Delete a meal entry by id.',
      inputSchema: { meal_id: z.number().int() },
    },
    async ({ meal_id }) => { await apiDelete(`/food/meals/${meal_id}`); return ok({ ok: true }); },
  );

  server.registerTool('set_weight',
    {
      description: 'Record body weight for a date (defaults to today). Stored on the food_day row.',
      inputSchema: { weight_kg: z.number(), date: z.string().optional() },
    },
    async ({ weight_kg, date }) => ok(await apiPatch(`/food/days/${encodeURIComponent(date || todayStr())}`, { weight_kg })),
  );

  server.registerTool('log_activity',
    {
      description: 'Record manual activity (steps, active calories, exercise minutes) for a date (defaults to today). Use when the user mentions e.g. "walked 8k steps" or "did 45 min of cardio".',
      inputSchema: {
        date: z.string().optional(),
        steps: z.number().int().optional(),
        active_calories: z.number().int().optional(),
        exercise_minutes: z.number().int().optional(),
      },
    },
    async ({ date, ...activity }) => ok(await apiPatch(`/food/days/${encodeURIComponent(date || todayStr())}`, activity)),
  );

  server.registerTool('get_food_targets',
    {
      description: 'Read the user\'s daily targets (calorie_target, protein_g_target, carbs_g_target, fat_g_target, weight_goal_kg).',
      inputSchema: {},
    },
    async () => ok(await apiGet('/food/settings')),
  );

  server.registerTool('set_food_targets',
    {
      description: 'Update one or more daily targets. Pass only what changes.',
      inputSchema: {
        calorie_target: z.number().int().optional(),
        protein_g_target: z.number().optional(),
        carbs_g_target: z.number().optional(),
        fat_g_target: z.number().optional(),
        weight_goal_kg: z.number().optional(),
      },
    },
    async (input) => ok(await apiPatch('/food/settings', input)),
  );

  // ---------- Coach (vision + goals + check-ins) ----------
  registerCoachTools(server);

  // ---------- Custom modules (user/AI-defined mini-apps) ----------
  registerModuleTools(server);

  // ---------- Agents & automations ----------
  registerAgentTools(server);
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function registerCoachTools(server) {
  // ---- Vision ----
  server.registerTool('get_vision',
    {
      description: 'Read the user\'s vision (north_star narrative, identity_statement, values). The vision is the highest layer of the goal hierarchy and should anchor every coaching decision.',
      inputSchema: {},
    },
    async () => ok(await apiGet('/coach/vision')),
  );

  server.registerTool('update_vision',
    {
      description: 'Update one or more vision fields. north_star is the multi-year narrative (markdown); identity_statement is "I am the kind of person who..."; values is core values as markdown bullets. Pass only the fields you\'re changing.',
      inputSchema: {
        north_star: z.string().optional(),
        identity_statement: z.string().optional(),
        values: z.string().optional(),
      },
    },
    async (patch) => ok(await apiPatch('/coach/vision', patch)),
  );

  server.registerTool('mark_vision_reviewed',
    {
      description: 'Stamp now() as the most recent vision review. Call this at the end of a biweekly vision check-in protocol.',
      inputSchema: {},
    },
    async () => ok(await apiPost('/coach/vision/mark_reviewed', {})),
  );

  // ---- Goals ----
  server.registerTool('list_goals',
    {
      description: 'List goals, optionally filtered by horizon (vision|year|quarter|month|week) and/or status (active|done|dropped|paused). Returns each goal with its obstacles and links to dashboard primitives.',
      inputSchema: {
        horizon: z.enum(['vision', 'year', 'quarter', 'month', 'week']).optional(),
        status: z.enum(['active', 'done', 'dropped', 'paused']).optional(),
      },
    },
    async ({ horizon, status }) => {
      const qs = new URLSearchParams();
      if (horizon) qs.set('horizon', horizon);
      if (status) qs.set('status', status);
      return ok(await apiGet(`/coach/goals${qs.toString() ? '?' + qs.toString() : ''}`));
    },
  );

  server.registerTool('get_goal',
    {
      description: 'Get a single goal by id with its obstacles and links.',
      inputSchema: { goal_id: z.number().int() },
    },
    async ({ goal_id }) => ok(await apiGet(`/coach/goals/${goal_id}`)),
  );

  server.registerTool('add_goal',
    {
      description: 'Create a new goal. Use horizon=year|quarter|month|week for operational goals; "vision" is reserved for top-level life-aim goals. Specify parent_id to nest under another goal (forming the tree from year → quarter → month → week). success_criteria should be specific and observable.',
      inputSchema: {
        title: z.string(),
        horizon: z.enum(['vision', 'year', 'quarter', 'month', 'week']).optional(),
        parent_id: z.number().int().optional(),
        description: z.string().optional(),
        target_date: z.string().optional(),
        success_criteria: z.string().optional(),
      },
    },
    async (input) => ok(await apiPost('/coach/goals', input)),
  );

  server.registerTool('update_goal',
    {
      description: 'Update any field of an existing goal. Set status="done" via complete_goal instead.',
      inputSchema: {
        goal_id: z.number().int(),
        title: z.string().optional(),
        description: z.string().optional(),
        horizon: z.enum(['vision', 'year', 'quarter', 'month', 'week']).optional(),
        status: z.enum(['active', 'dropped', 'paused']).optional(),
        target_date: z.string().optional(),
        success_criteria: z.string().optional(),
        parent_id: z.number().int().optional(),
      },
    },
    async ({ goal_id, ...patch }) => ok(await apiPatch(`/coach/goals/${goal_id}`, patch)),
  );

  server.registerTool('complete_goal',
    {
      description: 'Mark a goal as done (status=done, stamps completed_at). Celebrate the win in your response.',
      inputSchema: { goal_id: z.number().int() },
    },
    async ({ goal_id }) => ok(await apiPost(`/coach/goals/${goal_id}/complete`, {})),
  );

  server.registerTool('delete_goal',
    {
      description: 'Permanently delete a goal (cascades to its sub-goals, obstacles, and links). Prefer update_goal({status:"dropped"}) if you might want to revisit it later.',
      inputSchema: { goal_id: z.number().int() },
    },
    async ({ goal_id }) => { await apiDelete(`/coach/goals/${goal_id}`); return ok({ ok: true }); },
  );

  // ---- Obstacles (WOOP if-then) ----
  server.registerTool('add_obstacle',
    {
      description: 'Add a WOOP-style obstacle + implementation intention to a goal. obstacle = the predictable thing that derails this goal; if_then = the concrete plan ("IF X happens THEN I will Y"). Every active goal should have at least one.',
      inputSchema: {
        goal_id: z.number().int(),
        obstacle: z.string(),
        if_then: z.string(),
      },
    },
    async ({ goal_id, obstacle, if_then }) =>
      ok(await apiPost(`/coach/goals/${goal_id}/obstacles`, { obstacle, if_then })),
  );

  server.registerTool('delete_obstacle',
    {
      description: 'Remove an obstacle entry from a goal.',
      inputSchema: { obstacle_id: z.number().int() },
    },
    async ({ obstacle_id }) => { await apiDelete(`/coach/obstacles/${obstacle_id}`); return ok({ ok: true }); },
  );

  // ---- Goal ↔ primitive links ----
  server.registerTool('link_goal',
    {
      description: 'Link a goal to a downstream dashboard primitive so the rest of the app becomes goal-aware. kind = habit|card|routine|event|food_target|workout|module|module_item; target_id = the id in that table. Use this aggressively — every habit, routine, key task, and relevant custom-module item should be linked to the goal it serves.',
      inputSchema: {
        goal_id: z.number().int(),
        kind: z.enum(['habit', 'card', 'routine', 'event', 'food_target', 'workout', 'module', 'module_item']),
        target_id: z.number().int(),
        notes: z.string().optional(),
      },
    },
    async ({ goal_id, kind, target_id, notes }) =>
      ok(await apiPost(`/coach/goals/${goal_id}/links`, { kind, target_id, notes })),
  );

  server.registerTool('unlink_goal',
    {
      description: 'Remove a single goal-to-primitive link by link id.',
      inputSchema: { link_id: z.number().int() },
    },
    async ({ link_id }) => { await apiDelete(`/coach/links/${link_id}`); return ok({ ok: true }); },
  );

  // ---- Check-ins ----
  server.registerTool('list_check_ins',
    {
      description: 'List past check-ins. Filter by kind (morning = Daily Command Meeting | midday = Midday Recalibration | evening = Daily Closeout | weekly | biweekly_vision) and/or date range. Use to review the user\'s recent check-ins before drafting a weekly review or coaching response.',
      inputSchema: {
        kind: z.enum(['morning', 'midday', 'evening', 'weekly', 'biweekly_vision']).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      },
    },
    async ({ kind, from, to }) => {
      const qs = new URLSearchParams();
      if (kind) qs.set('kind', kind);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      return ok(await apiGet(`/coach/checkins${qs.toString() ? '?' + qs.toString() : ''}`));
    },
  );

  server.registerTool('log_check_in',
    {
      description: 'Save a check-in. Upserts on (kind, date) so calling twice for the same day overwrites. payload is a free-form JSON object — record REAL card ids so later check-ins can reconcile against actual tasks. Common shapes: morning (Daily Command Meeting) {must_win_card_id, must_win_title, supporting_card_ids, next_actions, captured_card_ids, constraints, if_then, habits_note}; midday (Midday Recalibration) {progress, must_win_card_id, decision: continue|reorder|defer, changes}; evening (Daily Closeout) {completed_card_ids, loose_ends, deferred, win, friction, adjustment, habits, food, workout}; weekly {wins, misses, adjustments}; biweekly_vision {vision_updates, identity_evolution}. coach_summary is your prose summary back to the user.',
      inputSchema: {
        kind: z.enum(['morning', 'midday', 'evening', 'weekly', 'biweekly_vision']),
        payload: z.record(z.any()),
        date: z.string().optional(),
        coach_summary: z.string().optional(),
      },
    },
    async (input) => ok(await apiPost('/coach/checkins', input)),
  );

  // ---- Briefing — the canonical "give me everything" tool ----
  server.registerTool('get_coach_briefing',
    {
      description: 'The single most important coach tool. Returns the full daily picture: task_snapshot (REAL board reality — per-board open/overdue/due-today/in-progress/undated/stale counts plus the actionable cards with their board/column/card ids and titles), vision, active goals (compact), today\'s check-in status (morning/midday/evening done?), cadence_pending flags (which check-ins are due), and recent check-ins. ALWAYS call this FIRST in any Daily Command Meeting, Midday Recalibration, Daily Closeout, weekly review, or whenever the user asks "what should I do today" / "how am I doing" — then read task_snapshot before asking the user anything, so you work from what is actually on their boards instead of interrogating them.',
      inputSchema: {},
    },
    async () => ok(await apiGet('/coach/briefing')),
  );

  // ---- Settings ----
  server.registerTool('get_coach_settings',
    {
      description: 'Read cadence toggles + times (morning_enabled/morning_time for the Daily Command Meeting, midday_enabled/midday_time for the Midday Recalibration, evening_enabled/evening_time for the Daily Closeout, weekly_enabled, weekly_dow, vision_review_interval_days) and the coaching_profile (motivational drivers, resistance patterns, challenge level, etc.).',
      inputSchema: {},
    },
    async () => ok(await apiGet('/coach/settings')),
  );

  server.registerTool('update_coach_settings',
    {
      description: 'Update cadence toggles or times. Times are "HH:MM" (24h). Use when the user says things like "turn off the midday check", "move my command meeting to 7am", or "recalibrate at 12:30 instead".',
      inputSchema: {
        morning_enabled: z.boolean().optional(),
        morning_time: z.string().optional(),
        midday_enabled: z.boolean().optional(),
        midday_time: z.string().optional(),
        evening_enabled: z.boolean().optional(),
        evening_time: z.string().optional(),
        weekly_enabled: z.boolean().optional(),
        weekly_dow: z.number().int().min(1).max(7).optional(),
        vision_review_interval_days: z.number().int().min(1).optional(),
      },
    },
    async (input) => ok(await apiPatch('/coach/settings', input)),
  );

  server.registerTool('update_coaching_profile',
    {
      description: 'Update the user\'s coaching profile — a structured object that captures what you\'ve learned about how to coach them effectively. Fields: motivational_drivers (string[]), resistance_patterns (string[]), avoidance_signals (string[]), communication_style (string), challenge_level (1-5 integer), breakthrough_moments ({date, description}[]), approaches_that_backfire (string[]). Pass only the fields to update; they merge into the existing profile. Pass a field as null to remove it. Validated and size-limited (8 KB).',
      inputSchema: {
        profile: z.record(z.any()),
      },
    },
    async ({ profile }) => ok(await apiPatch('/coach/coaching-profile', profile)),
  );
}

// Generic tools for user/AI-defined modules (mini-apps in the Library).
// A small fixed set that operates ANY module by reading its schema — so the
// coach can build and run custom trackers without per-module tool generation.
export function registerModuleTools(server) {
  async function resolveModule({ module, module_id }) {
    if (module_id != null) return apiGet(`/modules/${module_id}`);
    if (typeof module === 'number') return apiGet(`/modules/${module}`);
    if (!module) throw new Error('either module (name) or module_id required');
    const all = await apiGet('/modules');
    const q = String(module).toLowerCase();
    const matches = all.filter((m) => m.name.toLowerCase() === q || m.label.toLowerCase() === q);
    if (matches.length === 0) { const e = new Error(`module "${module}" not found`); e.code = 'not_found'; throw e; }
    if (matches.length > 1) { const e = new Error(`ambiguous_name: ${matches.length} modules match "${module}"`); e.code = 'ambiguous_name'; throw e; }
    return matches[0];
  }

  server.registerTool('list_modules',
    {
      description: 'List the user\'s custom modules (mini-apps in the Library) with each module\'s field schema. Modules are user/AI-defined trackers beyond the built-ins (Tasks/Habits/Food…). Call this to see what modules exist and what fields each has before adding or updating items.',
      inputSchema: {},
    },
    async () => ok(await apiGet('/modules')),
  );

  server.registerTool('create_module',
    {
      description: 'Create a new custom module — a mini-app that appears in the Library — when there is no built-in for what the user wants to track. schema is an array of field specs: [{key,label,type,options?,required?}], type ∈ text|number|bool|date|select (select needs options[]). Example "Books" tracker: [{"key":"title","label":"Title","type":"text","required":true},{"key":"rating","label":"Rating","type":"number"},{"key":"status","label":"Status","type":"select","options":["to-read","reading","done"]}]. After creating, tell the user it\'s in their Library.',
      inputSchema: {
        label: z.string(),
        name: z.string().optional(),
        group: z.string().optional(),
        icon: z.string().optional(),
        schema: z.array(z.object({
          key: z.string(),
          label: z.string().optional(),
          type: z.enum(['text', 'number', 'bool', 'date', 'select']),
          options: z.array(z.string()).optional(),
          required: z.boolean().optional(),
        })),
        config: z.record(z.any()).optional(),
      },
    },
    async ({ label, name, group, icon, schema, config }) => {
      const body = { label, schema };
      if (name) body.name = name;
      if (group) body.group_name = group;
      if (icon) body.icon = icon;
      if (config) body.config = config;
      return ok(await apiPost('/modules', body));
    },
  );

  server.registerTool('list_module_items',
    {
      description: 'List the items (rows) in a custom module. Specify the module by name or id. Optional q to text-search within the items.',
      inputSchema: {
        module: z.string().optional(),
        module_id: z.number().int().optional(),
        q: z.string().optional(),
      },
    },
    async ({ module, module_id, q }) => {
      const m = await resolveModule({ module, module_id });
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      return ok(await apiGet(`/modules/${m.id}/items${qs}`));
    },
  );

  server.registerTool('add_module_item',
    {
      description: 'Add an item to a custom module. data is an object keyed by the module\'s field keys (call list_modules first to see the schema); values must match the field types.',
      inputSchema: {
        module: z.string().optional(),
        module_id: z.number().int().optional(),
        data: z.record(z.any()),
      },
    },
    async ({ module, module_id, data }) => {
      const m = await resolveModule({ module, module_id });
      return ok(await apiPost(`/modules/${m.id}/items`, { data }));
    },
  );

  server.registerTool('update_module_item',
    {
      description: 'Update fields on a module item by id (merges into existing data). Get item_id from list_module_items.',
      inputSchema: { item_id: z.number().int(), data: z.record(z.any()) },
    },
    async ({ item_id, data }) => ok(await apiPatch(`/modules/item/${item_id}`, { data })),
  );

  server.registerTool('delete_module_item',
    {
      description: 'Delete a module item by id.',
      inputSchema: { item_id: z.number().int() },
    },
    async ({ item_id }) => { await apiDelete(`/modules/item/${item_id}`); return ok({ ok: true }); },
  );

  server.registerTool('list_module_templates',
    {
      description: 'Browse the prebuilt module-template catalog — ~55 ready-made trackers across health, mind, work, money, growth, people, home, and passions. Use this during onboarding (or whenever the user wants a new tracker) to propose a SET tailored to THIS person rather than a fixed default. Returns each template\'s key, label, group, one-line description, tags, and the external tool it pairs with (if any) — not the field schema. Instantiate a chosen one with create_module_from_template, which copies the fields for you.',
      inputSchema: {},
    },
    async () => {
      const data = await apiGet('/module-templates');
      const templates = (data.templates || []).map(({ schema, ...rest }) => rest);
      return ok({ groups: data.groups, templates });
    },
  );

  server.registerTool('create_module_from_template',
    {
      description: 'Create one of the catalog modules for the user from its template_key (get keys from list_module_templates). The fields are copied exactly server-side — you cannot mistype the schema, and the name never collides. Optionally override the label. Prefer this over create_module whenever a template fits; only hand-build with create_module when nothing in the catalog matches. After creating, confirm it is in the user\'s Library, add one example item so they see it working, and link it to the goal it serves.',
      inputSchema: { template_key: z.string(), label: z.string().optional() },
    },
    async ({ template_key, label }) => {
      const body = { template_key };
      if (label) body.label = label;
      return ok(await apiPost('/modules/from-template', body));
    },
  );
}

// Agents & automations: the user can save multiple agent setups (name +
// instructions + optional schedule). The coach is the implicit default; these
// tools let the coach set up and run the user's extra agents from chat.
export function registerAgentTools(server) {
  async function resolveAgent({ agent, agent_id }) {
    const all = await apiGet('/agents');
    if (agent_id != null) {
      const m = all.find((a) => a.id === agent_id);
      if (!m) { const e = new Error(`agent ${agent_id} not found`); e.code = 'not_found'; throw e; }
      return m;
    }
    if (!agent) throw new Error('either agent (name) or agent_id required');
    const q = String(agent).toLowerCase();
    const matches = all.filter((a) => a.name.toLowerCase() === q || a.label.toLowerCase() === q);
    if (matches.length === 0) { const e = new Error(`agent "${agent}" not found`); e.code = 'not_found'; throw e; }
    if (matches.length > 1) { const e = new Error(`ambiguous_name: ${matches.length} agents match "${agent}"`); e.code = 'ambiguous_name'; throw e; }
    return matches[0];
  }

  server.registerTool('list_agents',
    {
      description: 'List the user\'s saved agents/automations (the coach itself is the implicit default and is not listed). Shows each one\'s kind (scheduled|interactive), schedule, enabled state, and last run status/summary.',
      inputSchema: {},
    },
    async () => ok(await apiGet('/agents')),
  );

  server.registerTool('list_agent_templates',
    {
      description: 'Browse the catalog of ready-made agents/automations (Daily Brief, Inbox Triage, Weekly Reviewer, Accountability Nudge, Research Assistant, Money agent…) to propose to the user. Each has a key, label, kind, one-line description, and (for scheduled ones) a default schedule. Instantiate a chosen one with create_agent_from_template.',
      inputSchema: {},
    },
    async () => ok(await apiGet('/agents/templates')),
  );

  server.registerTool('create_agent_from_template',
    {
      description: 'Set up one of the catalog agents for the user from its template_key (keys from list_agent_templates). Scheduled ones begin running on their default schedule immediately; interactive ones can be opened from Library → Agents. Optionally override the label. After creating, tell the user it\'s set up and (for scheduled) when it will next run.',
      inputSchema: { template_key: z.string(), label: z.string().optional() },
    },
    async ({ template_key, label }) => {
      const body = { template_key };
      if (label) body.label = label;
      return ok(await apiPost('/agents/from-template', body));
    },
  );

  server.registerTool('create_agent',
    {
      description: 'Create a custom agent. kind="interactive" for one the user opens and chats with (give it instructions). kind="scheduled" for an automation that runs itself — for scheduled, also give a task (what it does each run) plus a schedule: schedule_freq (hourly|daily|weekly), schedule_time "HH:MM", and schedule_dow 1-7 (Mon-Sun) for weekly. Scheduled agents run UNATTENDED, so write the task to DRAFT or FLAG risky/outward actions (sending, deleting, spending), never perform them.',
      inputSchema: {
        label: z.string(),
        instructions: z.string(),
        kind: z.enum(['interactive', 'scheduled']).optional(),
        task: z.string().optional(),
        schedule_freq: z.enum(['manual', 'hourly', 'daily', 'weekly']).optional(),
        schedule_time: z.string().optional(),
        schedule_dow: z.number().int().min(1).max(7).optional(),
      },
    },
    async (input) => ok(await apiPost('/agents', input)),
  );

  server.registerTool('run_agent_now',
    {
      description: 'Run an agent right now (by name or id) and return its result — useful to test an automation or trigger one on demand.',
      inputSchema: { agent: z.string().optional(), agent_id: z.number().int().optional() },
    },
    async ({ agent, agent_id }) => {
      const a = await resolveAgent({ agent, agent_id });
      return ok(await apiPost(`/agents/${a.id}/run`, {}));
    },
  );

  server.registerTool('notify_user',
    {
      description: 'Push a short notification to the user (Telegram) — use when something needs their attention outside the chat: a background task finished, a reminder is due, or a heads-up they asked for. Keep it to a sentence or two. Returns {sent:false} if no notification channel is set up on this instance.',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ok(await apiPost('/notify', { text })),
  );
}
