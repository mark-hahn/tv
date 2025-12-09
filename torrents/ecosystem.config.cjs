module.exports = {
  apps: [{
    name: 'torrents-server',
    script: 'server.js',
    cwd: 'C:\\Users\\mark\\apps\\tv-series-client\\torrents',
    watch: true,
    autorestart: true,
    max_restarts: 10,
    output: 'C:\\Users\\mark\\apps\\tv-series-client\\torrents\\server.log',
    error: 'C:\\Users\\mark\\apps\\tv-series-client\\torrents\\server.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
