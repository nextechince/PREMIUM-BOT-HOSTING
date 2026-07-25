// ecosystem.config.js - PM2 configuration for production deployment

module.exports = {
  apps: [
    {
      name: 'premium-vps-bot',
      script: 'bot.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        BOT_TOKEN: '8190763429:AAEOqtHtckg81tztgLc8BEiBE98QFWeb4H4',
        OWNER_ID: '',
        ANNOUNCE_CHANNEL: '',
        PORT: 10460,
      },
      env_development: {
        NODE_ENV: 'development',
        BOT_TOKEN: '8190763429:AAEOqtHtckg81tztgLc8BEiBE98QFWeb4H4',
        OWNER_ID: '',
        ANNOUNCE_CHANNEL: '',
        PORT: 10460,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,
      instances: 1,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      exp_backoff_restart_delay: 100,
      watch: ['bot.js', 'admin_handlers.js'],
      ignore_watch: ['node_modules', 'logs', 'storage', 'sandbox', '.git'],
      watch_options: {
        followSymlinks: false,
        usePolling: true,
        interval: 1000,
        binaryInterval: 3000,
      },
    },
  ],
};