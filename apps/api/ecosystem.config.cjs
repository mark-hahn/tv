module.exports = {
  apps: [
    {
      name: 'torrents-server',
      script: 'src/server.js',
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
