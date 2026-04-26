'use strict';

/**
 * service-profiles.js -- Service-aware context profiles.
 *
 * When the user pastes output that mentions known services or process names,
 * these profiles tell the assistant what questions are worth asking and which
 * tools are useful for follow-up analysis.
 *
 * This is a sysadmin / DevOps knowledge base -- entirely diagnostic and
 * defensive in nature.  Nothing here is offensive or exploit-focused.
 */

const SERVICE_PROFILES = {
  ssh: {
    displayName: 'SSH',
    ports: [22],
    common_checks: [
      'Check authentication methods: cat /etc/ssh/sshd_config | grep -E "AuthMethod|PasswordAuth|PubkeyAuth"',
      'Review recent login activity: last -n 20',
      'Check for failed login attempts: journalctl -u sshd --since "1 hour ago" | grep Failed',
      'Audit authorized keys: find ~/.ssh -name authorized_keys -exec cat {} \\;',
      'Verify SSH daemon status: systemctl status sshd',
    ],
    tools: ['ssh', 'sshd', 'journalctl', 'last', 'who'],
    keywords: ['ssh', 'sshd', 'openssh', ':22', 'port 22'],
  },

  http: {
    displayName: 'HTTP / Web Server',
    ports: [80, 8080, 3000, 8000],
    common_checks: [
      'Check server headers: curl -I http://localhost',
      'List active connections: ss -tnp | grep :80',
      'Review access logs: tail -n 50 /var/log/nginx/access.log',
      'Check configuration: nginx -T 2>/dev/null || apache2ctl -S 2>/dev/null',
      'Look for running web processes: ps aux | grep -E "nginx|apache|node|python"',
    ],
    tools: ['curl', 'wget', 'nginx', 'apache2', 'ss'],
    keywords: ['http', 'nginx', 'apache', 'httpd', ':80', ':8080', 'web server'],
  },

  https: {
    displayName: 'HTTPS',
    ports: [443, 8443],
    common_checks: [
      'Check TLS certificate expiry: openssl s_client -connect localhost:443 </dev/null 2>/dev/null | openssl x509 -noout -dates',
      'Inspect cipher suites: openssl s_client -connect localhost:443 -cipher "ALL" </dev/null 2>&1 | grep Cipher',
      'Verify certificate chain: curl -vI https://localhost 2>&1 | grep -A5 "SSL"',
    ],
    tools: ['openssl', 'curl'],
    keywords: ['https', 'tls', 'ssl', ':443', 'certificate'],
  },

  mysql: {
    displayName: 'MySQL / MariaDB',
    ports: [3306],
    common_checks: [
      'Check if MySQL is running: systemctl status mysql || systemctl status mariadb',
      'Show current connections: mysqladmin -u root processlist',
      'List databases: mysql -u root -e "SHOW DATABASES;"',
      'Check bind address: grep -E "bind-address|skip-networking" /etc/mysql/mysql.conf.d/*.cnf',
    ],
    tools: ['mysql', 'mysqladmin', 'mysqldump'],
    keywords: ['mysql', 'mariadb', 'mysqld', ':3306'],
  },

  postgresql: {
    displayName: 'PostgreSQL',
    ports: [5432],
    common_checks: [
      'Check PostgreSQL status: systemctl status postgresql',
      'List databases: psql -U postgres -l',
      'Show active connections: psql -U postgres -c "SELECT * FROM pg_stat_activity;"',
      'Check listen addresses: grep listen_addresses /etc/postgresql/*/main/postgresql.conf',
    ],
    tools: ['psql', 'pg_dump'],
    keywords: ['postgres', 'postgresql', 'psql', ':5432'],
  },

  redis: {
    displayName: 'Redis',
    ports: [6379],
    common_checks: [
      'Check Redis status: redis-cli ping',
      'View configuration: redis-cli CONFIG GET bind',
      'Check memory usage: redis-cli INFO memory | grep used_memory_human',
      'List connected clients: redis-cli CLIENT LIST',
    ],
    tools: ['redis-cli'],
    keywords: ['redis', ':6379'],
  },

  docker: {
    displayName: 'Docker',
    ports: [2375, 2376],
    common_checks: [
      'List running containers: docker ps',
      'Check resource usage: docker stats --no-stream',
      'Inspect exposed ports: docker ps --format "table {{.Names}}\\t{{.Ports}}"',
      'View recent logs: docker logs --tail 50 <container_name>',
      'Check Docker daemon config: cat /etc/docker/daemon.json',
    ],
    tools: ['docker', 'docker-compose'],
    keywords: ['docker', 'container', ':2375', ':2376'],
  },

  ftp: {
    displayName: 'FTP',
    ports: [21],
    common_checks: [
      'Check FTP service: systemctl status vsftpd || systemctl status proftpd',
      'Review configuration: cat /etc/vsftpd.conf | grep -v "^#"',
      'List active connections: netstat -tnp | grep :21',
    ],
    tools: ['ftp', 'vsftpd'],
    keywords: ['ftp', 'vsftpd', 'proftpd', ':21'],
  },

  dns: {
    displayName: 'DNS',
    ports: [53],
    common_checks: [
      'Test DNS resolution: dig @localhost google.com',
      'Check BIND status: systemctl status named || systemctl status bind9',
      'View DNS configuration: cat /etc/resolv.conf',
      'Test reverse lookup: nslookup 127.0.0.1',
    ],
    tools: ['dig', 'nslookup', 'host'],
    keywords: ['dns', 'named', 'bind', ':53'],
  },
};

function detectServices(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = [];

  for (const [key, profile] of Object.entries(SERVICE_PROFILES)) {
    const matched = profile.keywords.some(kw => lower.includes(kw));
    if (matched && !found.includes(key)) {
      found.push(key);
    }
  }

  return found;
}

function buildServiceContext(serviceKeys) {
  if (!serviceKeys.length) return '';

  const lines = ['Detected services in the conversation:'];
  for (const key of serviceKeys) {
    const p = SERVICE_PROFILES[key];
    if (!p) continue;
    lines.push(`\n${p.displayName}:`);
    lines.push('  Useful checks:');
    p.common_checks.slice(0, 3).forEach(c => lines.push(`    - ${c}`));
    lines.push(`  Common tools: ${p.tools.join(', ')}`);
  }

  return lines.join('\n');
}

module.exports = { SERVICE_PROFILES, detectServices, buildServiceContext };
