import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { loadConfig } from '../server/config.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const LABEL = 'local.twitch-dvr';
const PLIST = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);

// dataDir comes from user-editable config.json; & or < in any path corrupts the plist XML
function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plistContent(dataDir: string): string {
  const logs = path.join(dataDir, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(tsxCli)}</string>
    <string>${xml(path.join(ROOT, 'server', 'index.ts'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(logs, 'out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logs, 'err.log'))}</string>
</dict></plist>
`;
}

// launchctl load/unload are the legacy forms, kept because the modern
// bootstrap/bootout need the gui/$UID domain target and these still work fine
const cmd = process.argv[2];
if (cmd === 'install') {
  const config = loadConfig(ROOT);
  try { execSync(`launchctl unload '${PLIST}'`, { stdio: 'ignore' }); } catch { /* not loaded */ }
  fs.writeFileSync(PLIST, plistContent(config.dataDir));
  try {
    execSync(`launchctl load '${PLIST}'`);
  } catch (err) {
    fs.rmSync(PLIST, { force: true }); // don't leave a half-installed agent behind
    console.error(`launchctl load failed — nothing was installed.\n${String(err)}`);
    process.exit(1);
  }
  console.log(`Installed and started ${LABEL}\n  plist: ${PLIST}\n  open http://localhost:${config.port}`);
} else if (cmd === 'uninstall') {
  try { execSync(`launchctl unload '${PLIST}'`, { stdio: 'ignore' }); } catch { /* not loaded */ }
  fs.rmSync(PLIST, { force: true });
  console.log(`Uninstalled ${LABEL}`);
} else {
  console.error('usage: tsx scripts/service.ts install|uninstall');
  process.exit(1);
}
