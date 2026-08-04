module.exports = {
  apps: [
    {
      name: 'hotel-crm-api',
      script: './backend/dist/server.js',
      // node_args loads .env into process.env at startup via Node 20's built-in --env-file flag.
      node_args: '--env-file=./backend/.env',
      cwd: '/home/ubuntu/apps/hotel-crm',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: '/home/ubuntu/.pm2/logs/api-error.log',
      out_file: '/home/ubuntu/.pm2/logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'hotel-crm-worker',
      script: './backend/dist/worker.js',
      node_args: '--env-file=./backend/.env',
      cwd: '/home/ubuntu/apps/hotel-crm',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/home/ubuntu/.pm2/logs/worker-error.log',
      out_file: '/home/ubuntu/.pm2/logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
