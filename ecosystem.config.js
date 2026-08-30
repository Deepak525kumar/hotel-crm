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
    {
      // Internal app distribution portal (daiwi/): upload an .ipa/.apk, publish
      // an install link. Served by nginx at /version-control and /install.
      //
      // Deliberately does NOT spread `common`: that would hand this process
      // --env-file=./backend/.env, i.e. the CRM's database URL, JWT secret and
      // API keys. This service is the most exposed process on the box (it
      // accepts uploads and serves anonymous pages) and gets only its own
      // config, its own database role, and its own S3 prefix.
      name: 'hotel-crm-version-control',
      script: './dist/server.js',
      cwd: '/home/ubuntu/apps/hotel-crm/daiwi',
      node_args: '--env-file=/home/ubuntu/apps/hotel-crm/daiwi/.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Parsing an IPA holds the zip's entries in memory; 600M leaves headroom
      // over the largest builds without masking a genuine leak.
      max_memory_restart: '600M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      error_file: '/home/ubuntu/.pm2/logs/version-control-error.log',
      out_file: '/home/ubuntu/.pm2/logs/version-control-out.log',
    },
  ],
};
