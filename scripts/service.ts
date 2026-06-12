import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { loadConfig } from '../server/config.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const LABEL = 'local.twitch-dvr';
const PLIST = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);

function plistContent(): string {
  const config = loadConfig(ROOT);
  const logs = path.join(config.dataDir, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${process.execPath}</string>
    <string>${tsxCli}</string>
    <string>${path.join(ROOT, 'server', 'index.ts')}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(logs, 'out.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(logs, 'err.log')}</string>
</dict></plist>
`;
}

const cmd = process.argv[2];
if (cmd === 'install') {
  try { execSync(`launchctl unload ${PLIST}`, { stdio: 'ignore' }); } catch { /* not loaded */ }
  fs.writeFileSync(PLIST, plistContent());
  execSync(`launchctl load ${PLIST}`);
  console.log(`Installed and started ${LABEL}\n  plist: ${PLIST}\n  open http://localhost:${loadConfig(ROOT).port}`);
} else if (cmd === 'uninstall') {
  try { execSync(`launchctl unload ${PLIST}`, { stdio: 'ignore' }); } catch { /* not loaded */ }
  fs.rmSync(PLIST, { force: true });
  console.log(`Uninstalled ${LABEL}`);
} else {
  console.error('usage: tsx scripts/service.ts install|uninstall');
  process.exit(1);
}
