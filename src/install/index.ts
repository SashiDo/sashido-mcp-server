import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SERVER_VERSION } from '../version.js';

/**
 * `npx @sashido/mcp-server install`: connects the editors on this machine
 * (Claude Code, Cursor, Codex) to the hosted SashiDo MCP server and gives
 * them the SashiDo skills. Running it again updates; `uninstall` removes
 * exactly what it wrote; `status` says what is installed.
 *
 * It never asks for the access token and never writes it anywhere: each
 * editor reads it from its own secure storage or from the environment.
 */

export const MCP_URL = 'https://mcp.sashido.io/mcp';
export const TOKEN_ENV = 'SASHIDO_ACCESS_TOKEN';
export const EDITORS = ['claude', 'cursor', 'codex'] as const;
export type Editor = (typeof EDITORS)[number];

const MARKETPLACE = 'sashido/sashido-mcp-server';
const PLUGIN = 'sashido';
/** Skills outside a plugin share one folder with everyone else's: ours are told apart by this */
const PREFIX = 'sashido-';

export interface Shell {
  /** Runs a command; `null` when the program isn't there */
  run(command: string, args: string[], env?: Record<string, string>): { status: number | null; output: string } | null;
}

export interface InstallOptions {
  home?: string;
  /** The folder with one subfolder per skill, each with a SKILL.md */
  skillsDir?: string;
  shell?: Shell;
  log?: (line: string) => void;
  /** Says what would be done and changes nothing */
  dryRun?: boolean;
}

interface Manifest {
  version: string;
  /** Skill folders this command created */
  skills: string[];
  /** Config files it added the server to */
  mcp: string[];
  /** Codex's config, when the section was appended by this command */
  codexConfig?: string;
  editors: Editor[];
}

const realShell: Shell = {
  run(command, args, env) {
    const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, ...env } });
    if (result.error) {
      return null;
    }
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
  },
};

/** The skills as published: next to dist/ in the package, in plugins/ in the repository */
export function bundledSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'sashido', 'skills');
}

const manifestPath = (home: string) => join(home, '.sashido', 'agents.json');

function readManifest(home: string): Manifest {
  try {
    const m = JSON.parse(readFileSync(manifestPath(home), 'utf8')) as Partial<Manifest>;
    return { version: m.version ?? '', skills: m.skills ?? [], mcp: m.mcp ?? [], editors: m.editors ?? [], codexConfig: m.codexConfig };
  } catch {
    return { version: '', skills: [], mcp: [], editors: [] };
  }
}

/** Which of the editors look installed for this user */
export function detectEditors(home: string, shell: Shell): Editor[] {
  const has = (program: string, folder: string) =>
    existsSync(join(home, folder)) || shell.run(program, ['--version']) !== null;
  return EDITORS.filter((e) => has(e, e === 'claude' ? '.claude' : e === 'cursor' ? '.cursor' : '.codex'));
}

/**
 * A skill as other editors need it: the folder and the name carry our
 * prefix (they share the folder with other vendors' skills), and so does
 * every mention of a sibling skill.
 */
export function standaloneSkill(text: string, names: string[]): string {
  let out = text.replace(/^(---\nname: )(.+)$/m, `$1${PREFIX}$2`);
  for (const name of names) {
    out = out.split(`\`${name}\``).join(`\`${PREFIX}${name}\``);
  }
  return out;
}

function listSkills(skillsDir: string): string[] {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
}

/** Copies the skills to ~/.agents/skills, which Cursor and Codex both read */
function installSkills(ctx: Ctx, manifest: Manifest): void {
  const names = listSkills(ctx.skillsDir);
  const root = join(ctx.home, '.agents', 'skills');
  for (const name of names) {
    const folder = join(root, `${PREFIX}${name}`);
    if (existsSync(folder) && manifest.skills.indexOf(folder) === -1) {
      ctx.log(`  kept ${folder}: it was there before and isn't ours to replace`);
      continue;
    }
    ctx.log(`  skill ${folder}`);
    if (!ctx.dryRun) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'SKILL.md'), standaloneSkill(readFileSync(join(ctx.skillsDir, name, 'SKILL.md'), 'utf8'), names));
      if (manifest.skills.indexOf(folder) === -1) {
        manifest.skills.push(folder);
      }
    }
  }
  // a skill that a newer version dropped or renamed
  for (const folder of manifest.skills.slice()) {
    if (names.map((n) => join(root, `${PREFIX}${n}`)).indexOf(folder) === -1) {
      ctx.log(`  removed ${folder}: no longer part of the skills`);
      if (!ctx.dryRun) {
        removeSkillFolder(folder);
        manifest.skills.splice(manifest.skills.indexOf(folder), 1);
      }
    }
  }
}

function removeSkillFolder(folder: string): void {
  // only ever a folder named like ours
  if (folder.split(/[\\/]/).pop()!.indexOf(PREFIX) === 0) {
    rmSync(folder, { recursive: true, force: true });
  }
}

interface Ctx {
  home: string;
  skillsDir: string;
  shell: Shell;
  log: (line: string) => void;
  dryRun: boolean;
}

function installClaude(ctx: Ctx, update: boolean): boolean {
  ctx.log('Claude Code: the SashiDo plugin (the connection and the skills)');
  // Installing a plugin that is already there (by this command or by hand)
  // succeeds and leaves it at its old version, so the update always follows.
  const refresh = [
    ['plugin', 'marketplace', 'update', PLUGIN],
    ['plugin', 'update', `${PLUGIN}@${PLUGIN}`],
  ];
  const steps: string[][] = update ? refresh : [['plugin', 'install', PLUGIN, '--marketplace', MARKETPLACE], ...refresh];
  for (const args of steps) {
    ctx.log(`  claude ${args.join(' ')}`);
    if (ctx.dryRun) {
      continue;
    }
    // without it the marketplace is cloned over SSH, which needs a GitHub key
    const result = ctx.shell.run('claude', args, { CLAUDE_CODE_PLUGIN_PREFER_HTTPS: '1' });
    if (!result) {
      ctx.log('  The `claude` command was not found. In Claude Code run: /plugin install sashido --marketplace sashido/sashido-mcp-server');
      return false;
    }
    if (result.status !== 0) {
      ctx.log(`  It failed:\n${result.output}`);
      return false;
    }
  }
  ctx.log('  Next, in Claude Code: /plugin configure sashido@sashido if it has no token yet (it asks once and keeps it in secure storage), then /reload-plugins.');
  return true;
}

/** Adds the server to Cursor's own config, with the token read from the environment */
function installCursor(ctx: Ctx, manifest: Manifest): boolean {
  ctx.log('Cursor: the connection');
  const file = join(ctx.home, '.cursor', 'mcp.json');
  const entry = { url: MCP_URL, headers: { Authorization: `Bearer \${env:${TOKEN_ENV}}` } };
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      ctx.log(`  ${file} is not valid JSON, so it was left alone. Add this under "mcpServers" yourself:\n  "sashido": ${JSON.stringify(entry)}`);
      return false;
    }
  }
  const servers = (config.mcpServers = config.mcpServers ?? {});
  const existing = servers.sashido;
  if (existing && JSON.stringify(existing) !== JSON.stringify(entry) && manifest.mcp.indexOf(file) === -1) {
    ctx.log(`  kept the "sashido" server already in ${file}: it isn't ours to replace`);
    return true;
  }
  ctx.log(`  server "sashido" in ${file}`);
  if (!ctx.dryRun) {
    servers.sashido = entry;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    if (manifest.mcp.indexOf(file) === -1) {
      manifest.mcp.push(file);
    }
  }
  return true;
}

/** What this command appends to Codex's config when its own command isn't there */
export const CODEX_SECTION = `
# SashiDo MCP server (added by "npx @sashido/mcp-server install")
[mcp_servers.sashido]
url = "${MCP_URL}"
bearer_token_env_var = "${TOKEN_ENV}"
`;

function installCodex(ctx: Ctx, manifest: Manifest): boolean {
  ctx.log('Codex: the connection');
  const args = ['mcp', 'add', 'sashido', '--url', MCP_URL, '--bearer-token-env-var', TOKEN_ENV];
  // the desktop app has the config and no `codex` command
  if (ctx.shell.run('codex', ['--version']) !== null) {
    ctx.log(`  codex ${args.join(' ')}`);
    if (ctx.dryRun) {
      return true;
    }
    const result = ctx.shell.run('codex', args);
    if (result && result.status === 0) {
      return true;
    }
    ctx.log(`  It failed${result ? `:\n${result.output}` : ''}`);
  }
  const file = join(ctx.home, '.codex', 'config.toml');
  const config = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (/^\s*\[mcp_servers\.sashido\]/m.test(config)) {
    ctx.log(`  kept the [mcp_servers.sashido] section already in ${file}`);
    return true;
  }
  ctx.log(`  section [mcp_servers.sashido] appended to ${file}`);
  if (!ctx.dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${config}${config && !config.endsWith('\n') ? '\n' : ''}${CODEX_SECTION}`);
    manifest.codexConfig = file;
  }
  return true;
}

function tokenNote(ctx: Ctx, editors: Editor[]): void {
  if (editors.indexOf('cursor') === -1 && editors.indexOf('codex') === -1) {
    return;
  }
  ctx.log('');
  ctx.log(`The access token: Cursor and Codex read it from the environment variable ${TOKEN_ENV}.`);
  ctx.log('  1. Create one in the SashiDo Dashboard: Account > Access Tokens. Read-only is the safe start.');
  ctx.log(`  2. Add it to your shell profile:  export ${TOKEN_ENV}=sashido_pat_...`);
  ctx.log('  3. Restart the editor.');
  ctx.log('This command never asks for the token and never writes it to a file, and you should not paste it into a chat: whoever holds it can do what it allows.');
}

function context(options: InstallOptions): Ctx {
  const home = options.home ?? homedir();
  const log = options.log ?? ((line: string) => console.log(line));
  return {
    home,
    skillsDir: options.skillsDir ?? bundledSkillsDir(),
    shell: options.shell ?? realShell,
    // paths are shown from the home folder, as people write them
    log: (line) => log(line.split(home).join('~')),
    dryRun: !!options.dryRun,
  };
}

/** Installs for the given editors, or updates what an earlier run installed */
export function install(editors: Editor[], options: InstallOptions = {}): { done: Editor[]; failed: Editor[] } {
  const ctx = context(options);
  const manifest = readManifest(ctx.home);
  const done: Editor[] = [];
  const failed: Editor[] = [];
  ctx.log(`SashiDo for AI coding assistants, version ${SERVER_VERSION}${ctx.dryRun ? ' (dry run: nothing is changed)' : ''}`);
  ctx.log('');

  for (const editor of editors) {
    let ok: boolean;
    if (editor === 'claude') {
      ok = installClaude(ctx, manifest.editors.indexOf('claude') !== -1);
    } else if (editor === 'cursor') {
      ok = installCursor(ctx, manifest);
    } else {
      ok = installCodex(ctx, manifest);
    }
    (ok ? done : failed).push(editor);
  }
  if (editors.indexOf('cursor') !== -1 || editors.indexOf('codex') !== -1) {
    ctx.log('Cursor and Codex: the skills');
    installSkills(ctx, manifest);
  }
  tokenNote(ctx, editors);

  if (!ctx.dryRun) {
    manifest.version = SERVER_VERSION;
    manifest.editors = EDITORS.filter((e) => manifest.editors.indexOf(e) !== -1 || done.indexOf(e) !== -1);
    mkdirSync(dirname(manifestPath(ctx.home)), { recursive: true });
    writeFileSync(manifestPath(ctx.home), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  ctx.log('');
  ctx.log('To update later, run the same command again:  npx @sashido/mcp-server@latest install');
  ctx.log('To check that everything works:               npx @sashido/mcp-server@latest doctor');
  return { done, failed };
}

/** Removes what `install` wrote, and nothing else */
export function uninstall(options: InstallOptions = {}): void {
  const ctx = context(options);
  const manifest = readManifest(ctx.home);
  for (const folder of manifest.skills) {
    ctx.log(`removed ${folder}`);
    if (!ctx.dryRun) {
      removeSkillFolder(folder);
    }
  }
  for (const file of manifest.mcp) {
    try {
      const config = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, unknown> };
      if (config.mcpServers && config.mcpServers.sashido) {
        ctx.log(`removed server "sashido" from ${file}`);
        if (!ctx.dryRun) {
          delete config.mcpServers.sashido;
          writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
        }
      }
    } catch {
      ctx.log(`left ${file} alone: it can't be read`);
    }
  }
  if (manifest.editors.indexOf('claude') !== -1) {
    ctx.log(`claude plugin uninstall ${PLUGIN}@${PLUGIN}`);
    if (!ctx.dryRun) {
      ctx.shell.run('claude', ['plugin', 'uninstall', `${PLUGIN}@${PLUGIN}`]);
    }
  }
  if (manifest.codexConfig && existsSync(manifest.codexConfig)) {
    const config = readFileSync(manifest.codexConfig, 'utf8');
    if (config.indexOf(CODEX_SECTION) !== -1) {
      ctx.log(`removed section [mcp_servers.sashido] from ${manifest.codexConfig}`);
      if (!ctx.dryRun) {
        writeFileSync(manifest.codexConfig, config.replace(CODEX_SECTION, ''));
      }
    } else {
      ctx.log(`left ${manifest.codexConfig} alone: the section was changed since it was added`);
    }
  } else if (manifest.editors.indexOf('codex') !== -1) {
    ctx.log('Codex: if you no longer want it, run: codex mcp remove sashido (or delete [mcp_servers.sashido] from ~/.codex/config.toml).');
  }
  if (!ctx.dryRun) {
    rmSync(manifestPath(ctx.home), { force: true });
  }
}

export function status(options: InstallOptions = {}): void {
  const ctx = context(options);
  const manifest = readManifest(ctx.home);
  if (!manifest.version) {
    ctx.log('Nothing was installed by this command. Run: npx @sashido/mcp-server@latest install');
    return;
  }
  ctx.log(`Installed version ${manifest.version}; this command is version ${SERVER_VERSION}.`);
  ctx.log(`Editors: ${manifest.editors.join(', ') || 'none'}`);
  manifest.skills.forEach((s) => ctx.log(`  skill ${s}${existsSync(s) ? '' : ' (missing)'}`));
  manifest.mcp.forEach((f) => ctx.log(`  server in ${f}`));
  ctx.log(process.env[TOKEN_ENV] ? `${TOKEN_ENV} is set in this shell.` : `${TOKEN_ENV} is not set in this shell.`);
}

const USAGE = `Usage: npx @sashido/mcp-server@latest <command> [options]

  install     Connect your editors to SashiDo and give them the SashiDo skills.
              Run it again to update.
  uninstall   Remove what install wrote.
  doctor      Check the whole setup: the server, the token, each editor, the skills.
  status      Show what this command installed.

Options for install:
  --claude --cursor --codex   Only these editors (default: the ones found on this machine)
  --dry-run                   Say what would be done, change nothing

Without a command it starts the MCP server itself (what an editor runs).`;

/** The command line: `true` when the arguments were a command of ours */
export async function runCommand(argv: string[], options: InstallOptions = {}): Promise<boolean> {
  const command = argv[0];
  const ctx = context({ ...options, dryRun: options.dryRun || argv.indexOf('--dry-run') !== -1 });
  const pass: InstallOptions = { ...options, dryRun: ctx.dryRun };
  if (command === 'help' || command === '--help' || command === '-h') {
    ctx.log(USAGE);
    return true;
  }
  if (command === 'uninstall') {
    uninstall(pass);
    return true;
  }
  if (command === 'status') {
    status(pass);
    return true;
  }
  if (command === 'doctor') {
    const { doctor } = await import('./doctor.js');
    const healthy = await doctor({ home: ctx.home, shell: ctx.shell, env: process.env, fetch, log: ctx.log });
    if (!healthy) {
      process.exitCode = 1;
    }
    return true;
  }
  if (command !== 'install' && command !== 'update') {
    return false;
  }
  const asked = EDITORS.filter((e) => argv.indexOf(`--${e}`) !== -1);
  const editors = asked.length ? asked : detectEditors(ctx.home, ctx.shell);
  if (!editors.length) {
    ctx.log('No Claude Code, Cursor or Codex was found on this machine. Name one: --claude, --cursor or --codex.');
    process.exitCode = 1;
    return true;
  }
  const { failed } = install(editors, pass);
  if (failed.length) {
    process.exitCode = 1;
  }
  return true;
}
