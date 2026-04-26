'use strict';

/**
 * system.js -- Real-time system information plugin.
 *
 * Sections:
 *   cpu       -- Model, core count, speed, load averages
 *   memory    -- Total / used / free in GB and percent
 *   os        -- Platform, release, hostname, uptime, user
 *   network   -- External network interfaces (IP, family, CIDR)
 *   processes -- Top processes by name, PID, CPU%, MEM%
 *   all       -- All of the above in a single call
 *
 * Dependencies: Node.js built-ins only (os, child_process).
 */

const os           = require('os');
const { execSync } = require('child_process');

module.exports = {
  name: 'system',
  description:
    'Retrieve live system information: CPU, memory, OS details, uptime, ' +
    'network interfaces, and running processes. No external dependencies.',
  parameters: {
    section: {
      type:        'string',
      enum:        ['all', 'cpu', 'memory', 'os', 'network', 'processes'],
      default:     'all',
      description: 'Which category to retrieve. Omit or use "all" for everything.',
    },
  },

  async execute(input) {
    const section = input?.section || 'all';

    const collectors = {
      cpu:       getCpu,
      memory:    getMemory,
      os:        getOsInfo,
      network:   getNetwork,
      processes: getProcesses,
    };

    if (section === 'all') {
      const result = {};
      for (const [key, fn] of Object.entries(collectors)) {
        try       { result[key] = fn(); }
        catch (e) { result[key] = { _error: e.message }; }
      }
      return result;
    }

    if (!collectors[section]) {
      const valid = ['all', ...Object.keys(collectors)].join(', ');
      throw new Error(`Unknown section "${section}". Valid options: ${valid}`);
    }

    return { [section]: collectors[section]() };
  },
};

// ── Collectors ────────────────────────────────────────────────────────────────

function getCpu() {
  const cpus  = os.cpus();
  const loads = os.loadavg(); // [1m, 5m, 15m] — always [0,0,0] on Windows

  return {
    model:    cpus[0]?.model?.trim() || 'Unknown',
    cores:    cpus.length,
    speedMHz: cpus[0]?.speed || 0,
    loadAvg:  {
      '1m':  +loads[0].toFixed(2),
      '5m':  +loads[1].toFixed(2),
      '15m': +loads[2].toFixed(2),
    },
  };
}

function getMemory() {
  const total = os.totalmem();
  const free  = os.freemem();
  const used  = total - free;
  return {
    totalGB: toGB(total),
    usedGB:  toGB(used),
    freeGB:  toGB(free),
    usedPct: +((used / total) * 100).toFixed(1),
    freePct: +((free / total) * 100).toFixed(1),
  };
}

function getOsInfo() {
  const uptimeSec = os.uptime();
  return {
    platform:  os.platform(),
    release:   os.release(),
    arch:      os.arch(),
    hostname:  os.hostname(),
    username:  os.userInfo().username,
    homedir:   os.homedir(),
    tmpdir:    os.tmpdir(),
    uptimeSec,
    uptime:    formatUptime(uptimeSec),
  };
}

function getNetwork() {
  const ifaces = os.networkInterfaces();
  const result = [];

  for (const [name, addrs] of Object.entries(ifaces || {})) {
    for (const addr of (addrs || [])) {
      if (addr.internal) continue; // skip loopback
      result.push({
        interface: name,
        family:    addr.family,  // 'IPv4' | 'IPv6'
        address:   addr.address,
        cidr:      addr.cidr,
        mac:       addr.mac,
      });
    }
  }

  return result;
}

function getProcesses() {
  try {
    if (os.platform() === 'win32') {
      // Windows: tasklist with CSV output
      const raw = execSync(
        'tasklist /FO CSV /NH',
        { timeout: 8_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const procs = raw.trim().split('\n').slice(0, 25).map(line => {
        const parts = line.split('","').map(p => p.replace(/^"|"$/g, ''));
        return {
          name:     parts[0] || '',
          pid:      parts[1] || '',
          session:  parts[2] || '',
          memUsage: parts[4] || '',
        };
      }).filter(p => p.name);

      return { platform: 'win32', count: procs.length, processes: procs };

    } else {
      // Unix: ps aux sorted by CPU (descending)
      const raw = execSync(
        'ps aux --sort=-%cpu 2>/dev/null || ps aux',
        { timeout: 8_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const lines = raw.trim().split('\n');
      const procs = lines.slice(1, 26).map(line => {
        const cols = line.trim().split(/\s+/);
        return {
          user:    cols[0],
          pid:     cols[1],
          cpuPct:  cols[2],
          memPct:  cols[3],
          vsz:     cols[4],
          rss:     cols[5],
          command: cols.slice(10).join(' '),
        };
      });

      return { platform: os.platform(), count: procs.length, processes: procs };
    }
  } catch (err) {
    return { _error: 'Could not retrieve processes: ' + err.message, processes: [] };
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function toGB(bytes) {
  return +(bytes / 1e9).toFixed(2);
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
