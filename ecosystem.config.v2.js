module.exports = {
  apps: [{
    name: 'seo-checker-v2',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 3838,
      HOST: '0.0.0.0'
    },
    log_file: './logs/seo-v2-combined.log',
    out_file: './logs/seo-v2-out.log',
    error_file: './logs/seo-v2-error.log',
    time: true,
    merge_logs: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 2000
  }]
};