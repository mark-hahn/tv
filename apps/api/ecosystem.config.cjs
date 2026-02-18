module.exports = {
  apps: [
    {
      name: 'tv-api',
      script: './start-with-xvfb.sh',
      interpreter: '/bin/bash',
      cwd: __dirname,
      watch: false,
      ignore_watch: ['node_modules', 'data', 'secrets'],
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
        ,DISABLE_INTERNAL_CORS: '1'
      }
    }
  ]
};
