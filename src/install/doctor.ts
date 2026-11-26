import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SERVER_VERSION } from '../version.js';
import { compareVersions } from '../upgrade/versions.js';
import { Editor, MCP_URL, TOKEN_ENV, Shell, detectEditors } from './index.js';

/**
 * `npx @sashido/mcp-server doctor`: checks the whole setup from end to end
 * and says, for each thing that is off, what to do about it. It reads and
 * asks; it changes nothing.
 *
 * The one thing it sends anywhere is the access token from the environment,
 * to the SashiDo MCP server it is for, to see whether the server takes it.
 */

export type Level = 'ok' | 'warn' | 'fail';

export interface Check {
  level: Level;
  what: string;
  /** What to do, when it isn't ok */
  fix?: string;
}

export interface DoctorOptions {
  home: string;
  shell: Shell;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  log: (line: string) => void;
  /** Only these editors; default: the ones found on the machine */
  only?: Editor[];
}

const INSTALL = 'npx @sashido/mcp-server@latest install';
const MARK: Record<Level, string> = { ok: '✓', warn: '!', fail: '✗' };

async function serverChecks(o: DoctorOptions): Promise<Check[]> {
  const out: Check[] = [];
  const health = MCP_URL.replace(/\/mcp$/, '/health');
  let current: string | undefined;
  try {
    const res = await o.fetch(health);
    current = ((await res.json()) as { version?: string }).version;
    out.push({ level: 'ok', what: `The SashiDo MCP server answers (version ${current ?? 'unknown'}).` });
  } catch (e) {
    out.push({
      level: 'fail',
      what: `The SashiDo MCP server can't be reached at ${health}: ${e instanceof Error ? e.message : 'no answer'}.`,
      fix: 'Check your connection, a proxy or a firewall, and try again.',
    });
    return out;
  }
  if (current && compareVersions(current, SERVER_VERSION) > 0) {
    out.push({ level: 'warn', what: `This command is version ${SERVER_VERSION}; ${current} is out.`, fix: `Run: ${INSTALL}` });
  }
  return out;
}

async function tokenChecks(o: DoctorOptions, needed: boolean): Promise<Check[]> {
  const token = o.env[TOKEN_ENV];
  if (!token) {
    return [
      needed
        ? {
            level: 'fail',
            what: `${TOKEN_ENV} is not set in this shell. Cursor and Codex read the access token from it.`,
            fix: `Create a token in the SashiDo Dashboard (Account > Access Tokens), add "export ${TOKEN_ENV}=sashido_pat_..." to your shell profile, open a new terminal and restart the editor.`,
          }
        : { level: 'ok', what: `${TOKEN_ENV} is not set, and nothing here needs it: Claude Code keeps the token in its own secure storage.` },
    ];
  }
  try {
    const res = await o.fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    if (res.status === 401 || res.status === 403) {
      return [
        {
          level: 'fail',
          what: `The server refuses the token in ${TOKEN_ENV}: it is wrong, expired or revoked.`,
          fix: 'Create a new one in the SashiDo Dashboard (Account > Access Tokens) and replace it in your shell profile.',
        },
      ];
    }
    const body = (await res.json()) as { result?: { tools?: unknown[] } };
    const tools = body.result?.tools?.length;
    if (!res.ok || tools === undefined) {
      return [{ level: 'warn', what: `The server answered ${res.status} to the token in ${TOKEN_ENV}; try again in a minute.` }];
    }
    return [{ level: 'ok', what: `The server takes the token in ${TOKEN_ENV}: it allows ${tools} tools.` }];
  } catch (e) {
    return [{ level: 'warn', what: `The token in ${TOKEN_ENV} could not be tried: ${e instanceof Error ? e.message : 'no answer'}.` }];
  }
}

function claudeChecks(o: DoctorOptions): Check[] {
  const list = o.shell.run('claude', ['plugin', 'list']);
  if (!list) {
    return [{ level: 'warn', what: 'Claude Code: the `claude` command was not found, so the plugin could not be checked.' }];
  }
  const at = list.output.indexOf('sashido@sashido');
  if (at === -1) {
    return [{ level: 'fail', what: 'Claude Code: the SashiDo plugin is not installed.', fix: `Run: ${INSTALL} --claude` }];
  }
  const version = /Version:\s*([0-9.]+)/.exec(list.output.slice(at))?.[1];
  if (version && compareVersions(version, SERVER_VERSION) < 0) {
    return [{ level: 'warn', what: `Claude Code: the SashiDo plugin is version ${version}; ${SERVER_VERSION} is out.`, fix: `Run: ${INSTALL} --claude, then /reload-plugins in Claude Code` }];
  }
  return [
    {
      level: 'ok',
      what: `Claude Code: the SashiDo plugin is installed${version ? ` (version ${version})` : ''}. Its token is in Claude Code's secure storage, which can't be read from here: if its tools say there is no token, run /plugin configure sashido@sashido.`,
    },
  ];
}

function cursorChecks(o: DoctorOptions): Check[] {
  const file = join(o.home, '.cursor', 'mcp.json');
  try {
    const servers = (JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, { url?: string }> }).mcpServers ?? {};
    if (servers.sashido) {
      return [{ level: 'ok', what: 'Cursor: the `sashido` server is in ~/.cursor/mcp.json.' }];
    }
  } catch {
    // no file, or not JSON: the same advice
  }
  return [{ level: 'fail', what: 'Cursor: no `sashido` server in ~/.cursor/mcp.json.', fix: `Run: ${INSTALL} --cursor` }];
}

function codexChecks(o: DoctorOptions): Check[] {
  const file = join(o.home, '.codex', 'config.toml');
  if (existsSync(file) && /^\s*\[mcp_servers\.sashido\]/m.test(readFileSync(file, 'utf8'))) {
    return [{ level: 'ok', what: 'Codex: the [mcp_servers.sashido] section is in ~/.codex/config.toml.' }];
  }
  return [{ level: 'fail', what: 'Codex: no [mcp_servers.sashido] section in ~/.codex/config.toml.', fix: `Run: ${INSTALL} --codex` }];
}

function skillChecks(o: DoctorOptions): Check[] {
  const entry = join(o.home, '.agents', 'skills', 'sashido-backend', 'SKILL.md');
  if (!existsSync(entry)) {
    return [{ level: 'fail', what: 'Cursor and Codex: the SashiDo skills are not in ~/.agents/skills.', fix: `Run: ${INSTALL}` }];
  }
  const version = /These skills are version ([0-9.]+)\./.exec(readFileSync(entry, 'utf8'))?.[1];
  if (!version || compareVersions(version, SERVER_VERSION) < 0) {
    return [{ level: 'warn', what: `Cursor and Codex: the SashiDo skills are version ${version ?? 'unknown'}; ${SERVER_VERSION} is out.`, fix: `Run: ${INSTALL}` }];
  }
  return [{ level: 'ok', what: `Cursor and Codex: the SashiDo skills are in ~/.agents/skills (version ${version}).` }];
}

/** Runs every check and prints them; `true` when nothing failed */
export async function doctor(o: DoctorOptions): Promise<boolean> {
  const editors = o.only && o.only.length ? o.only : detectEditors(o.home, o.shell);
  const others = editors.indexOf('cursor') !== -1 || editors.indexOf('codex') !== -1;
  const checks: Check[] = [...(await serverChecks(o))];
  if (!editors.length) {
    checks.push({ level: 'fail', what: 'No Claude Code, Cursor or Codex was found on this machine.', fix: 'Install one of them, then run: ' + INSTALL });
  }
  if (editors.indexOf('claude') !== -1) {
    checks.push(...claudeChecks(o));
  }
  if (editors.indexOf('cursor') !== -1) {
    checks.push(...cursorChecks(o));
  }
  if (editors.indexOf('codex') !== -1) {
    checks.push(...codexChecks(o));
  }
  if (others) {
    checks.push(...skillChecks(o));
  }
  // a token that fails is only worth trying when the server is there
  if (checks[0]!.level !== 'fail') {
    checks.push(...(await tokenChecks(o, others)));
  }

  o.log(`SashiDo for AI coding assistants: checking the setup (this command is version ${SERVER_VERSION})`);
  o.log('');
  for (const c of checks) {
    o.log(`${MARK[c.level]} ${c.what}`);
    if (c.fix) {
      o.log(`    ${c.fix}`);
    }
  }
  const failed = checks.filter((c) => c.level === 'fail').length;
  const warned = checks.filter((c) => c.level === 'warn').length;
  o.log('');
  o.log(
    failed || warned
      ? `${failed ? `${failed} to fix` : ''}${failed && warned ? ', ' : ''}${warned ? `${warned} worth a look` : ''}.`
      : 'Everything is in place. Ask your assistant: "Which SashiDo apps do I have?"',
  );
  return failed === 0;
}
