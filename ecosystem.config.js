module.exports = {
  apps: [
    {
      name: 'hotel-crm-api',
      script: './backend/dist/server.js',
      // node_args loads /etc/hotel-crm/.env into process.env at startup via
      // Node 20's built-in --env-file flag; replaces the non-native env_file key.
      node_args: '--env-file=/etc/hotel-crm/.env',
      cwd: '/opt/hotel-crm',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: '/var/log/hotel-crm/api-error.log',
      out_file: '/var/log/hotel-crm/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      // Platform Worker (ADR-029, GD-01 — Epic 7 PR 7.2): the asynchronous
      // execution runtime that drains the transactional outbox and hosts
      // scheduled jobs. A separate process over the same backend build/image as
      // hotel-crm-api (same dist, same /etc/hotel-crm/.env), never serving HTTP.
      name: 'hotel-crm-worker',
      script: './backend/dist/worker.js',
      node_args: '--env-file=/etc/hotel-crm/.env',
      cwd: '/opt/hotel-crm',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/hotel-crm/worker-error.log',
      out_file: '/var/log/hotel-crm/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'hotel-crm-web',
      script: './node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/opt/hotel-crm/frontend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/hotel-crm/web-error.log',
      out_file: '/var/log/hotel-crm/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
