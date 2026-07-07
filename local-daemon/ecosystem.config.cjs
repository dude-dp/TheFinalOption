// PM2 Ecosystem Configuration for TheFinalOption Local Daemon
// Manages auto-restart, log rotation, and cron-based scheduling

module.exports = {
  apps: [
    {
      name: 'thefinaloption-daemon',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: __dirname,

      // Auto-restart on crashes with exponential backoff
      autorestart: true,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,

      // Start only during Indian market hours (IST 8:45 AM - 3:45 PM)
      // Daemon self-manages its active window, but PM2 cron provides an extra layer
      cron_restart: '45 8 * * 1-5',

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/daemon-error.log',
      out_file: './logs/daemon-out.log',
      merge_logs: true,
      log_type: 'json',

      // Resource limits
      max_memory_restart: '256M',

      // Watch for file changes (disable in production)
      watch: false,
    },
  ],
};
