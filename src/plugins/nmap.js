'use strict';

/**
 * nmap.js -- Nmap integration plugin.
 *
 * Actions:
 *   parse  -- Parse existing nmap text / grepable output into structured JSON.
 *             No dependencies, works on any platform.
 *
 *   scan   -- Run nmap against a target and parse the result.
 *             Requires nmap to be installed on the system.
 *             Input is sanitised — only hostname / IP / CIDR chars are allowed.
 *
 * The plugin is designed for legitimate network inventory and diagnostics.
 * The 'scan' action runs the exact command the user would run themselves.
 */

const { execSync } = require('child_process');

// Regex that only allows safe target strings (no shell metacharacters)
const SAFE_TARGET_RE = /^[a-zA-Z0-9.\-:/_,\s]+$/;

module.exports = {
  name: 'nmap',
  description:
    'Parse nmap scan output into structured JSON (hosts, open ports, services, versions). ' +
    'Can also run a live nmap scan if nmap is installed.',
  parameters: {
    action: {
      type:        'string',
      enum:        ['parse', 'scan'],
      default:     'parse',
      description: 'parse = interpret existing nmap output | scan = run nmap and parse',
    },
    output: {
      type:        'string',
      description: 'Raw nmap text output to parse (required for action: parse)',
    },
    target: {
      type:        'string',
      description: 'Host, IP, or CIDR range to scan (required for action: scan)',
    },
    flags: {
      type:        'string',
      default:     '-sV --open -T4',
      description: 'Additional nmap flags (action: scan only)',
    },
  },

  async execute(input) {
    const { action = 'parse' } = input || {};

    if (action === 'parse') {
      if (!input?.output) {
        throw new Error(
          'Provide nmap text output in the "output" field. ' +
          'Paste the full output of your nmap command.'
        );
      }
      return parseNmapOutput(input.output);
    }

    if (action === 'scan') {
      if (!input?.target) {
        throw new Error('Provide a "target" hostname, IP address, or CIDR range.');
      }
      return runScan(input.target, input.flags ?? '-sV --open -T4');
    }

    throw new Error(`Unknown action "${action}". Use parse or scan.`);
  },
};

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse nmap normal-format (-oN) or default stdout output into structured data.
 * Handles: host lines, status, open ports, OS detection, MAC addresses.
 *
 * @param   {string} raw
 * @returns {object}
 */
function parseNmapOutput(raw) {
  const hosts = [];
  let current = null;

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();

    // ── New host ──────────────────────────────────────────────────────────────
    // "Nmap scan report for hostname (1.2.3.4)"  or  "Nmap scan report for 1.2.3.4"
    const hostM = line.match(/^Nmap scan report for (.+)$/);
    if (hostM) {
      if (current) hosts.push(current);
      const token  = hostM[1];
      const ipM    = token.match(/^(.+?)\s+\((\d[\d.]+)\)$/);
      current = {
        hostname: ipM ? ipM[1]  : null,
        ip:       ipM ? ipM[2]  : token,
        status:   'unknown',
        latency:  null,
        os:       null,
        mac:      null,
        vendor:   null,
        ports:    [],
      };
      continue;
    }

    if (!current) continue;

    // ── Host status ────────────────────────────────────────────────────────
    // "Host is up (0.0012s latency)."
    const statusM = line.match(/^Host is (up|down)(?:\s+\(([^)]+)\))?/);
    if (statusM) {
      current.status  = statusM[1];
      current.latency = statusM[2] || null;
      continue;
    }

    // ── Port entry ─────────────────────────────────────────────────────────
    // "22/tcp   open  ssh     OpenSSH 8.9p1 Ubuntu 3ubuntu0.6"
    const portM = line.match(
      /^(\d+)\/(tcp|udp)\s+(open|closed|filtered|open\|filtered)\s+(\S+)(?:\s+(.+))?$/
    );
    if (portM) {
      current.ports.push({
        port:     parseInt(portM[1], 10),
        protocol: portM[2],
        state:    portM[3],
        service:  portM[4],
        version:  portM[5]?.trim() || null,
      });
      continue;
    }

    // ── OS detection ──────────────────────────────────────────────────────
    // "OS details: Linux 5.15"  |  "Aggressive OS guesses: ..."
    const osM = line.match(/^(?:OS details?|Aggressive OS guesses?): (.+)$/);
    if (osM && !current.os) {
      current.os = osM[1].split(',')[0].trim(); // take the first guess only
      continue;
    }

    // ── MAC address ───────────────────────────────────────────────────────
    // "MAC Address: AA:BB:CC:DD:EE:FF (Vendor Inc)"
    const macM = line.match(/^MAC Address: ([0-9A-F:]{17})\s+\((.+)\)$/i);
    if (macM) {
      current.mac    = macM[1];
      current.vendor = macM[2];
      continue;
    }
  }

  if (current) hosts.push(current);

  // ── Summary ───────────────────────────────────────────────────────────────
  const openPorts = hosts.flatMap(h => h.ports.filter(p => p.state === 'open'));
  const services  = [...new Set(openPorts.map(p => p.service).filter(Boolean))].sort();

  // "Nmap done: 2 IP addresses (1 host up) scanned in 3.14 seconds"
  const doneM   = raw.match(/Nmap done:\s+(\d+)\s+IP.+?in\s+([0-9.]+)\s+seconds/);
  const versionM = raw.match(/^# Nmap (\S+)/m) || raw.match(/Starting Nmap (\S+)/);

  return {
    nmapVersion:  versionM ? versionM[1] : null,
    hosts,
    summary: {
      hostsScanned: doneM ? parseInt(doneM[1]) : hosts.length,
      hostsUp:      hosts.filter(h => h.status === 'up').length,
      openPortCount: openPorts.length,
      services,
      scanTimeSec:  doneM ? parseFloat(doneM[2]) : null,
    },
  };
}

// ── Live scan ─────────────────────────────────────────────────────────────────

function runScan(target, flags) {
  if (!SAFE_TARGET_RE.test(target)) {
    throw new Error(
      'Target contains invalid characters. ' +
      'Only hostnames, IP addresses, and CIDR notation are accepted.'
    );
  }

  const cmd = `nmap ${flags} ${target}`;
  let raw;

  try {
    raw = execSync(cmd, {
      timeout: 120_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // nmap not installed
    if (err.code === 'ENOENT' || /not found|not recognized/i.test(err.message)) {
      throw new Error(
        'nmap is not installed or not in PATH. ' +
        'Install it (https://nmap.org/download) and retry, or paste ' +
        'existing scan output and use action: parse.'
      );
    }
    // nmap ran but returned non-zero (e.g., all hosts down) — still parse
    raw = (err.stdout || '') + (err.stderr || '');
    if (!raw.includes('Nmap') && !raw.includes('scan report')) {
      throw new Error(`nmap failed: ${err.message}`);
    }
  }

  const parsed = parseNmapOutput(raw);
  return { command: cmd, raw, ...parsed };
}
