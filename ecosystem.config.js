const common = {
  node_args: '--env-file=./backend/.env',
  cwd: '/home/ubuntu/apps/hotel-crm',
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  watch: false,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'hotel-crm-api',
      script: './backend/dist/server.js',
      max_memory_restart: '700M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: '/home/ubuntu/.pm2/logs/api-error.log',
      out_file: '/home/ubuntu/.pm2/logs/api-out.log',
    },
    {
      ...common,
      name: 'hotel-crm-worker',
      script: './backend/dist/worker.js',
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/home/ubuntu/.pm2/logs/worker-error.log',
      out_file: '/home/ubuntu/.pm2/logs/worker-out.log',
    },
  ],
};
