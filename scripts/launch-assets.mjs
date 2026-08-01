import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const REQUIRED_STATIC_ASSETS = [
  'helm-architecture.png',
  'helm-linkedin-01-product.png',
  'helm-linkedin-02-architecture.png',
  'helm-linkedin-03-method.png',
];

export function launchAssetPlan() {
  return [
    {
      file: 'helm-architecture.png',
      kind: 'architecture',
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
      aspect: '16:9',
      minWidth: 1920,
    },
    ...[
      ['helm-linkedin-01-product.png', 'product'],
      ['helm-linkedin-02-architecture.png', 'architecture'],
      ['helm-linkedin-03-method.png', 'method'],
    ].map(([file, slide]) => ({
      file,
      kind: 'carousel',
      slide,
      viewport: { width: 1080, height: 1350 },
      deviceScaleFactor: 2,
      aspect: '4:5',
      minWidth: 1080,
    })),
  ];
}

const architectureCore = () => `
  <div class="eyebrow">LOCAL-FIRST RUNTIME · ONE TRUSTED OPERATOR</div>
  <h1>Helm v0 architecture</h1>
  <p class="lede">One loopback web app. One local SQLite state. Optional AI and MCP boundaries stay explicit.</p>
  <main class="diagram" aria-label="Helm runtime architecture">
    <svg viewBox="0 0 1760 700" role="img" aria-labelledby="diagram-title diagram-desc">
      <title id="diagram-title">Helm runtime architecture</title>
      <desc id="diagram-desc">Browser and MCP clients connect to an Express API backed by SQLite. In-app AI requests pass through a provider gateway to Claude Code or selected remote APIs.</desc>
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 Z" fill="#70849e"/></marker>
        <marker id="arrowRemote" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 Z" fill="#e9a46b"/></marker>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#1d2633" stroke-width="1"/></pattern>
      </defs>
      <rect width="1760" height="700" rx="28" fill="#0d1219"/><rect width="1760" height="700" rx="28" fill="url(#grid)" opacity=".62"/>
      <rect x="30" y="34" width="1210" height="632" rx="24" fill="rgba(20,30,42,.58)" stroke="#53677f" stroke-width="2"/><text x="58" y="70" class="boundary">THIS MAC · LOOPBACK BY DEFAULT</text>
      <rect x="1272" y="34" width="458" height="632" rx="24" fill="rgba(63,38,23,.24)" stroke="#c77d45" stroke-width="2" stroke-dasharray="10 8"/><text x="1300" y="70" class="boundary remote">OPTIONAL EXTERNAL PROCESSING</text>
      <path d="M250 185H380" class="flow" marker-end="url(#arrow)"/><text x="315" y="167" class="flow-label">HTTP · 127.0.0.1</text>
      <path d="M690 185H825" class="flow" marker-end="url(#arrow)"/><text x="758" y="167" class="flow-label">SQL</text>
      <path data-flow="api-to-gateway" d="M690 225H750V405H825" class="flow" marker-end="url(#arrow)"/><text x="766" y="387" class="flow-label">Coach request</text>
      <path data-flow="gateway-to-tools" d="M825 440H690" class="flow" marker-end="url(#arrow)"/><text x="758" y="422" class="flow-label">reduced tools</text>
      <path data-flow="tools-to-api" d="M535 365V265" class="flow" marker-end="url(#arrow)"/><text x="586" y="321" class="flow-label">result + readback</text>
      <path data-flow="gateway-to-claude-code" d="M1135 410H1260V210H1340" class="flow remote-flow" marker-end="url(#arrowRemote)"/>
      <path data-flow="gateway-to-api-profiles" d="M1135 470H1260V445H1340" class="flow remote-flow" marker-end="url(#arrowRemote)"/>
      <text x="1175" y="332" class="flow-label remote">selected context leaves the Mac</text>
      <text x="1298" y="192" class="flow-label remote">CLI</text><text x="1298" y="427" class="flow-label remote">API</text>
      <path d="M250 575H380" class="flow" marker-end="url(#arrow)"/><text x="315" y="557" class="flow-label">stdio / HTTP</text>
      <path data-flow="adapter-to-api" d="M690 575H720V295H710V265" class="flow" marker-end="url(#arrow)"/><text x="785" y="557" class="flow-label">authenticated HTTP</text>
      <g class="node frontend"><rect x="70" y="115" width="180" height="140" rx="18"/><text x="160" y="172" class="node-title">Browser</text><text x="160" y="204" class="node-sub">React + Vite</text><text x="160" y="228" class="node-meta">Browser on this Mac</text></g>
      <g class="node backend"><rect x="380" y="105" width="310" height="160" rx="18"/><text x="535" y="165" class="node-title">Express API</text><text x="535" y="200" class="node-sub">auth · routes · schedulers</text><text x="535" y="228" class="node-meta">serves web/dist</text></g>
      <g class="node data"><rect x="825" y="105" width="310" height="160" rx="18"/><text x="980" y="165" class="node-title">SQLite</text><text x="980" y="200" class="node-sub">local operating state</text><text x="980" y="228" class="node-meta">secrets stay outside SQLite</text></g>
      <g class="node gateway"><rect x="825" y="350" width="310" height="180" rx="18"/><text x="980" y="410" class="node-title">Provider gateway</text><text x="980" y="445" class="node-sub">profiles · models · safe errors</text><text x="980" y="475" class="node-meta">AI optional · no-AI remains usable</text></g>
      <g class="node tools"><rect x="380" y="365" width="310" height="150" rx="18"/><text x="535" y="420" class="node-title">Helm tool boundary</text><text x="535" y="455" class="node-sub">reduced in-app tools</text><text x="535" y="483" class="node-meta">mutation requires readback</text></g>
      <g class="node external"><rect x="1340" y="125" width="322" height="170" rx="18"/><text x="1501" y="180" class="node-title">Claude Code</text><text x="1501" y="214" class="node-sub">official local CLI auth path</text><text x="1501" y="246" class="node-meta">provider-owned processing</text></g>
      <g class="node external"><rect x="1340" y="350" width="322" height="190" rx="18"/><text x="1501" y="405" class="node-title">Verified API profiles</text><text x="1501" y="442" class="node-sub">Anthropic · OpenAI</text><text x="1501" y="472" class="node-sub">Gemini · OpenRouter</text><text x="1501" y="510" class="node-meta">user-owned keys · provider billing</text></g>
      <g class="node client"><rect x="70" y="520" width="180" height="110" rx="18"/><text x="160" y="568" class="node-title">MCP client</text><text x="160" y="599" class="node-sub">compatible assistant</text></g>
      <g class="node adapter"><rect x="380" y="520" width="310" height="110" rx="18"/><text x="535" y="568" class="node-title">MCP adapter</text><text x="535" y="599" class="node-sub">maps tools to Helm API</text></g>
    </svg>
  </main>
  <footer><span><b>Stored locally</b> Browser, API, SQLite, config</span><span><b>Separate boundaries</b> Optional AI providers and MCP clients</span><span><b>Default network</b> 127.0.0.1 only</span></footer>`;

const sharedAssetStyles = `
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#090d12;color:#edf1f7}body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;padding:56px 64px}.eyebrow{font-size:16px;letter-spacing:.18em;color:#7caeff;font-weight:750;margin-bottom:14px}h1{font-family:Georgia,"Times New Roman",serif;font-size:58px;line-height:1.04;letter-spacing:-.035em;margin:0 0 12px}.lede{font-size:21px;color:#9ca8b8;margin:0 0 28px}.diagram{border:1px solid #202a37;border-radius:28px;overflow:hidden}svg{display:block;width:100%;height:auto}.boundary{fill:#8fa0b5;font:700 15px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em}.boundary.remote,.flow-label.remote{fill:#e9a46b}.flow{fill:none;stroke:#70849e;stroke-width:3}.remote-flow{stroke:#e9a46b;stroke-dasharray:8 7}.flow-label{fill:#8190a3;font:500 14px ui-monospace,SFMono-Regular,Menlo,monospace;text-anchor:middle}.node rect{fill:#111923;stroke-width:2}.node-title{fill:#f2f5f9;font:700 24px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-anchor:middle}.node-sub{fill:#b4becb;font:500 18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-anchor:middle}.node-meta{fill:#7f8da0;font:500 14px ui-monospace,SFMono-Regular,Menlo,monospace;text-anchor:middle}.frontend rect{stroke:#67a7ff}.backend rect,.tools rect{stroke:#65c9a3}.data rect{stroke:#a995ed}.gateway rect{stroke:#e5b85c}.external rect{stroke:#d28a52}.client rect,.adapter rect{stroke:#7d92ab}footer{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:22px;color:#8e9bac;font-size:16px}footer span{border-top:1px solid #263140;padding-top:14px}footer b{display:block;color:#dbe2eb;margin-bottom:5px}`;

export function architectureAssetHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helm v0 architecture</title><style>${sharedAssetStyles}</style></head><body>${architectureCore()}</body></html>`;
}

const carouselSlides = {
  product: { number: '01 / 03', kicker: 'HELM · UNPUBLISHED v0 LAUNCH CANDIDATE', title: 'One operating loop.\nNot another dashboard.', body: 'Direction becomes a must-win. Work becomes evidence. Evidence becomes a better review.', foot: 'Port Aurora · synthetic workspace' },
  architecture: { number: '02 / 03', kicker: 'LOCAL-FIRST, NOT LOCAL-ONLY', title: 'Your operating state\nstays on your Mac.', body: 'React + Express + SQLite run on loopback. AI is optional; selected context leaves the Mac only when the operator chooses a provider.', foot: 'Claude Code · Anthropic · OpenAI · Gemini · OpenRouter' },
  method: { number: '03 / 03', kicker: 'BUILDER METHOD', title: 'Human judgment\nis the control plane.', body: 'Joel led product vision, architecture, requirements, orchestration, evaluation, privacy boundaries, and release decisions.', foot: 'AI agents collaborated on implementation and review' },
};

export function launchCarouselHtml(slideId = 'all') {
  const slides = slideId === 'all' ? Object.entries(carouselSlides) : [[slideId, carouselSlides[slideId]]];
  if (slides.some(([, slide]) => !slide)) throw new Error(`unknown carousel slide: ${slideId}`);
  const sections = slides.map(([id, slide]) => `<section class="slide slide-${id}"><header><span>HELM</span><span>${slide.number}</span></header><div class="content"><div class="kicker">${slide.kicker}</div><h1>${slide.title.replace('\n', '<br>')}</h1><p>${slide.body}</p>${id === 'method' ? '<ol><li>narrow milestones</li><li>one repository writer</li><li>test-first changes</li><li>exact acceptance evidence</li></ol>' : ''}</div><footer><span>${slide.foot}</span><span>SYNTHETIC · NOT PUBLISHED</span></footer></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helm launch carousel</title><style>*{box-sizing:border-box}html,body{margin:0;background:#090d12;color:#f1f4f8;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}.slide{width:1080px;height:1350px;padding:72px 76px;display:flex;flex-direction:column;background:#0b1016;position:relative;overflow:hidden}.slide:after{content:"";position:absolute;inset:0;background:linear-gradient(135deg,transparent 0 74%,rgba(105,158,232,.08));pointer-events:none}header,footer{display:flex;justify-content:space-between;position:relative;z-index:1}header{font:750 22px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;color:#94a1b2}.content{margin:auto 0;max-width:900px;position:relative;z-index:1}.kicker{color:#71a8f6;font-size:20px;line-height:1.3;letter-spacing:.12em;font-weight:750;margin-bottom:30px}h1{font-family:Georgia,"Times New Roman",serif;font-size:78px;line-height:1.02;letter-spacing:-.045em;margin:0 0 42px}p{font-size:31px;line-height:1.42;color:#b7c0cc;max-width:870px;margin:0}ol{display:grid;grid-template-columns:1fr 1fr;gap:18px 48px;padding:0;list-style-position:inside;margin:48px 0 0;font-size:24px;line-height:1.4;color:#d9dfe7}li{border-top:1px solid #2a3544;padding-top:16px}footer{font:650 17px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8290a2;letter-spacing:.04em}.slide-architecture .kicker{color:#e7b35b}.slide-method .kicker{color:#67cba4}</style></head><body>${sections}</body></html>`;
}

export function validateLaunchImageMeta({ width, height }, { aspect, minWidth }) {
  const [x, y] = aspect.split(':').map(Number);
  if (width * y !== height * x) throw new Error(`image is ${width}x${height}, not ${aspect}`);
  if (width < minWidth) throw new Error(`image is ${width}px wide; expected at least ${minWidth}px`);
}

export function standaloneArchitecturePath() {
  return path.join(ROOT, 'docs', 'helm-architecture.html');
}
