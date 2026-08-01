import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// One case, not one per class: these are a single contract — every review
// finding Helm accepted rather than fixed stays visible to a reader — and
// twenty-five passing assertions of it are one fact reported twenty-five times.
describe('accepted review findings remain visible as known limitations', () => {
  const ACCEPTED_CLASSES = [
    ['web-content prompt injection and egress', /prompt injection[\s\S]*outbound requests/i],
    ['prompt-only destructive confirmation', /destructive AI tool use[\s\S]*prompt instructions/i],
    ['AI estimates and heuristic health score', /health score[\s\S]*(estimates|heuristics)/i],
    ['auth-boundary coverage', /Authentication[\s\S]*not an exhaustive negative test matrix/i],
    ['network failure normalization', /network-error normalization/i],
    ['outbound fetch timeouts', /outbound integrations[\s\S]*timeouts/i],
    ['npm-audit date variance', /npm audit[\s\S]*(date|point-in-time)/i],
    ['upgrade launchctl race', /launchctl[\s\S]*race/i],
    ['rest-timer async error boundary', /Rest-timer[\s\S]*error boundary/i],
    ['card/tag atomicity', /card\/tag[\s\S]*not fully atomic/i],
    ['extreme habit-calendar ranges', /habit-calendar[\s\S]*extreme ranges/i],
    ['token-in-URL/history exposure', /Bearer tokens[\s\S]*(history|copied URLs)/i],
    ['MCP path-token and CORS exposure', /MCP HTTP transport[\s\S]*CORS/i],
    ['password and lockout limits', /password[\s\S]*lockout/i],
    ['error logging', /Error logging[\s\S]*incomplete/i],
    ['CLI/demo discoverability', /CLI and synthetic-demo[\s\S]*less discoverable/i],
    ['activity/API-only wording', /activity[\s\S]*API\/MCP-only/i],
    ['provider model lifecycle', /model identifiers[\s\S]*lifecycle/i],
    ['install/service startup races', /service startup[\s\S]*timing/i],
    ['notification response checks', /response checks[\s\S]*notification delivery/i],
    ['MCP nondefault-port configuration', /Non-default Helm ports[\s\S]*explicit MCP endpoint configuration/i],
    ['PWA and stale comments', /PWA metadata[\s\S]*comments/i],
    ['dead hidden views', /hidden view code[\s\S]*stale/i],
    ['SSE post-header hardening', /Server-sent-event failures[\s\S]*headers/i],
    ['tautological model test', /model-selection regression[\s\S]*tautological/i],
  ];

  it('documents every accepted finding class and stays linked from the README', () => {
    const limitations = read('docs/KNOWN-LIMITATIONS.md');
    const undocumented = ACCEPTED_CLASSES
      .filter(([, pattern]) => !pattern.test(limitations))
      .map(([name]) => name);
    assert.deepEqual(undocumented, [], 'these accepted findings are no longer documented');
    assert.match(read('README.md'), /\[Known limitations\]\(docs\/KNOWN-LIMITATIONS\.md\)/);
  });
});
