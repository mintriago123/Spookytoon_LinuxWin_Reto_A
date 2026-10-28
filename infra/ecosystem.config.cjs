const path = require('node:path');

module.exports = {
  apps: [{
    name: 'spookython-backend',
    cwd: path.resolve(__dirname, '../backend'),
    script: 'src/start.ts',
    interpreter: process.env.NODE_BINARY || 'node',
    node_args: ['--max-old-space-size=256', `--env-file=${process.env.BACKEND_ENV_FILE || '/etc/spookython/backend.env'}`],
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    kill_timeout: 45000,
    restart_delay: 3000,
    max_memory_restart: '650M',
    merge_logs: true,
    out_file: '/var/log/spookython/backend.jsonl',
    error_file: '/var/log/spookython/backend-error.jsonl',
    env: {
      NODE_ENV: 'production', PORT: '3001', HOST: '127.0.0.1',
      AWS_REGION: 'us-east-2', AWS_AVAILABILITY_ZONE: 'us-east-2a',
      DYNAMODB_TABLE_NAME: 'spookython-manta-state', ROUTING_WORKERS: '1', ROUTING_HTTP_MAX_SOCKETS: '8', LOG_HTTP_REQUESTS: 'false',
      FRONTEND_ORIGIN: 'https://3-128-78-190.sslip.io',
    },
  }],
};
