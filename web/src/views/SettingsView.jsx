import React, { useEffect, useState } from 'react';
import { useMcpServersStore } from '../state/mcpServers.js';

const TRANSPORTS = ['http', 'sse', 'stdio'];

function SecretRows({ rows, setRows, noun }) {
  function setRow(i, patch) { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); }
  function add() { setRows([...rows, { key: '', value: '' }]); }
  function del(i) { setRows(rows.filter((_, j) => j !== i)); }
  return (
    <div className="mcp-secrets">
      {rows.map((r, i) => (
        <div key={i} className="mcp-secret-row">
          <input type="text" placeholder={`${noun} name`} value={r.key} onChange={(e) => setRow(i, { key: e.target.value })} />
          <input type="text" placeholder="value (kept secret)" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} />
          <button type="button" className="danger-ghost" onClick={() => del(i)}>✕</button>
        </div>
      ))}
      <button type="button" onClick={add}>+ {noun.toLowerCase()}</button>
    </div>
  );
}

function AddServer({ onCreate }) {
  const [label, setLabel] = useState('');
  const [transport, setTransport] = useState('http');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [rows, setRows] = useState([{ key: '', value: '' }]);
  const [alwaysLoad, setAlwaysLoad] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const stdio = transport === 'stdio';

  async function submit() {
    setErr('');
    if (!label.trim()) { setErr('Give it a name.'); return; }
    if (!stdio && !url.trim()) { setErr('Enter the server URL.'); return; }
    if (stdio && !command.trim()) { setErr('Enter the command to run.'); return; }
    const secrets = {};
    for (const r of rows) { if (r.key.trim()) secrets[r.key.trim()] = r.value; }
    const body = { label: label.trim(), transport, always_load: alwaysLoad };
    if (stdio) {
      body.command = command.trim();
      body.args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
      body.env = secrets;
    } else {
      body.url = url.trim();
      body.headers = secrets;
    }
    setBusy(true);
    try {
      await onCreate(body);
      setLabel(''); setUrl(''); setCommand(''); setArgsText(''); setRows([{ key: '', value: '' }]);
    } catch (e) { setErr(e.message || 'Could not connect'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mcp-add">
      <h3>Connect a server</h3>
      <label className="module-field"><span className="muted small">Name</span>
        <input type="text" value={label} placeholder="e.g. Notion, Gmail, My API" onChange={(e) => setLabel(e.target.value)} /></label>
      <label className="module-field"><span className="muted small">Transport</span>
        <select value={transport} onChange={(e) => setTransport(e.target.value)}>
          {TRANSPORTS.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
        </select></label>
      {!stdio ? (
        <label className="module-field"><span className="muted small">Server URL</span>
          <input type="text" value={url} placeholder="https://mcp.example.com/mcp" onChange={(e) => setUrl(e.target.value)} /></label>
      ) : (
        <>
          <label className="module-field"><span className="muted small">Command</span>
            <input type="text" value={command} placeholder="npx" onChange={(e) => setCommand(e.target.value)} /></label>
          <label className="module-field"><span className="muted small">Arguments (space-separated)</span>
            <input type="text" value={argsText} placeholder="-y @modelcontextprotocol/server-name" onChange={(e) => setArgsText(e.target.value)} /></label>
        </>
      )}
      <div className="muted small module-fields-label">{stdio ? 'Environment variables' : 'Headers (e.g. Authorization: Bearer …)'}</div>
      <SecretRows rows={rows} setRows={setRows} noun={stdio ? 'Variable' : 'Header'} />
      <label className="mcp-req muted small">
        <input type="checkbox" checked={alwaysLoad} onChange={(e) => setAlwaysLoad(e.target.checked)} />
        Always load tools (uncheck = behind tool-search, ~5s faster startup)
      </label>
      {err && <p className="err">{err}</p>}
      <div className="module-form-actions"><button type="button" className="primary" disabled={busy} onClick={submit}>Connect</button></div>
    </div>
  );
}

function SelfPanel({ self }) {
  const [show, setShow] = useState(false);
  if (!self || !self.available) return null;
  const connector = self.url_token_endpoint || '';
  function copy(t) { try { navigator.clipboard.writeText(t); } catch { /* ignore */ } }
  const hidden = '••••••••••••';
  return (
    <div className="mcp-self">
      <h3>Helm as a tool server</h3>
      <p className="muted small">Drive Helm from Claude Desktop, Cursor, or any MCP client — they get all of Helm's tools.</p>
      {!self.public && (
        <p className="muted small">This endpoint is localhost-only right now. A public URL has to be enabled before you can connect from another device.</p>
      )}
      <div className="mcp-self-row">
        <span className="muted small">Endpoint</span>
        <code>{self.bearer_endpoint}</code>
        <button type="button" onClick={() => copy(self.bearer_endpoint)}>copy</button>
      </div>
      <div className="mcp-self-row">
        <span className="muted small">Token</span>
        <code>{show ? self.token : hidden}</code>
        <button type="button" onClick={() => setShow(!show)}>{show ? 'hide' : 'reveal'}</button>
        <button type="button" onClick={() => copy(self.token)}>copy</button>
      </div>
      <div className="mcp-self-row">
        <span className="muted small">Connector URL</span>
        <code>{show ? connector : connector.replace(self.token, '••••••')}</code>
        <button type="button" onClick={() => copy(connector)}>copy</button>
      </div>
    </div>
  );
}

export default function SettingsView() {
  const servers = useMcpServersStore((s) => s.servers);
  const status = useMcpServersStore((s) => s.status);
  const self = useMcpServersStore((s) => s.self);
  const fetchServers = useMcpServersStore((s) => s.fetchServers);
  const fetchStatus = useMcpServersStore((s) => s.fetchStatus);
  const fetchSelf = useMcpServersStore((s) => s.fetchSelf);
  const createServer = useMcpServersStore((s) => s.createServer);
  const updateServer = useMcpServersStore((s) => s.updateServer);
  const deleteServer = useMcpServersStore((s) => s.deleteServer);

  useEffect(() => {
    fetchServers().catch(() => {});
    fetchStatus().catch(() => {});
    fetchSelf().catch(() => {});
  }, [fetchServers, fetchStatus, fetchSelf]);

  return (
    <div className="mcp-view">
      <div className="mcp-intro">
        <h2>Connections</h2>
        <p className="muted small">Connect external MCP servers so the coach can act in your other tools (Notion, Gmail, your own API…). Their tools appear alongside Helm's own in chat.</p>
        {status && !status.sdk && (
          <p className="err small">This instance is on the API model backend, where external MCP tools don't run — they activate on the default (subscription) backend.</p>
        )}
      </div>

      <div className="mcp-list">
        {servers.length === 0 ? (
          <p className="muted small">No servers connected yet.</p>
        ) : servers.map((sv) => (
          <div key={sv.id} className={`mcp-row${sv.enabled ? '' : ' off'}`}>
            <div className="mcp-row-main">
              <strong>{sv.label}</strong>{' '}
              <span className="muted small">{sv.transport} · {sv.url || sv.command}</span>
              {Object.keys(sv.headers || {}).length > 0 && <span className="muted small"> · {Object.keys(sv.headers).length} secret(s)</span>}
              {Object.keys(sv.env || {}).length > 0 && <span className="muted small"> · {Object.keys(sv.env).length} var(s)</span>}
              {!sv.always_load && <span className="muted small"> · deferred</span>}
            </div>
            <div className="mcp-row-actions">
              <label className="mcp-req muted small">
                <input type="checkbox" checked={sv.enabled} onChange={(e) => updateServer(sv.id, { enabled: e.target.checked }).catch(() => {})} /> on
              </label>
              <button type="button" className="danger-ghost" onClick={() => deleteServer(sv.id).catch(() => {})}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <AddServer onCreate={createServer} />

      <SelfPanel self={self} />
    </div>
  );
}
