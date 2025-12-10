module.exports = {
  apps: [{
    name: 'torrents-server',
    script: 'src/server.js',
    cwd: 'C:\\Users\\mark\\apps\\tv-series-client\\torrents',
    out_file: 'C:\\Users\\mark\\.pm2\\logs\\torrents-server-out.log',
    error_file: 'C:\\Users\\mark\\.pm2\\logs\\torrents-server-error.log',
    watch: true,
    ignore_watch: ['node_modules', 'cookies/*.json'],
    autorestart: true,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
