// Renders a normalized message history into a single prompt string.
//
// Subscription-CLI providers (Claude Code, Codex) take one prompt per
// invocation rather than a structured message array, so the conversation has
// to be flattened. Shared by both runtimes so they describe history the same
// way and attachments degrade to the same visible placeholders.

export function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'image') parts.push(`[image attachment: ${block.source?.media_type || 'image'}]`);
    else if (block.type === 'document') parts.push(`[document attachment: ${block.source?.media_type || 'document'}]`);
    else if (block.type === 'tool_use') parts.push(`[called tool ${block.name}(${JSON.stringify(block.input).slice(0, 120)})]`);
    else if (block.type === 'tool_result') {
      const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
      parts.push(`[tool result: ${text.slice(0, 200)}]`);
    }
  }
  return parts.join(' ');
}

export function renderHistoryAsPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const current = messages.at(-1);
  const history = messages.slice(0, -1);
  let prompt = '';
  if (history.length) {
    prompt += '## Conversation history (for context — do not respond to these earlier turns)\n\n';
    for (const message of history) {
      const role = message.role === 'user' ? 'User' : 'Assistant';
      prompt += `**${role}:** ${flattenContent(message.content)}\n\n`;
    }
    prompt += '---\n\n## Current turn — respond to this\n\n';
  }
  return prompt + flattenContent(current.content);
}
