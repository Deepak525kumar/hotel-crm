module.exports = {
  apps: [
    {
      name: 'hotel-crm-api',
      // PM2 does not support an `env_file` option in ecosystem.config.js, so
      // launch via a bash wrapper that sources the secret file before exec'ing
      // node. `set -a` exports every variable defined in /etc/hotel-crm/.env.
      script: 'bash',
      args: [
        '-c',
        'set -a && . /etc/hotel-crm/.env && set +a && exec node /opt/hotel-crm/backend/dist/server.js',
      ],
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
      name: 'hotel-crm-web',
      script: 'bash',
      args: [
        '-c',
        'set -a && . /etc/hotel-crm/.env && set +a && exec node_modules/.bin/next start -p 3000',
      ],
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
