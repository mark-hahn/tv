module.exports = {
  apps: [{
    name: 'torrents-server',
    script: 'server.js',
    cwd: 'C:\\Users\\mark\\apps\\tv-series-client\\torrents',
    watch: true,
    ignore_watch: ['node_modules', 'cookies/*.json'],
    autorestart: true,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
