module.exports = {
  apps: [
    {
      name: 'torrents-server',
      script: 'src/server.js',
      cwd: '/mnt/media/archive/dev/apps/torrents',
      watch: false,
      ignore_watch: ['node_modules', 'cookies/*.json', 'reelgood.log', 'reel-shows.json', 'reelgood-titles.json'],
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
        ,DISABLE_INTERNAL_CORS: '1'
      }
    }
  ]
};
