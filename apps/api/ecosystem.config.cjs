module.exports = {
  apps: [
    {
      name: 'torrents-server',
      script: 'src/server.js',
      cwd: '/root/dev/apps/torrents',
      watch: false,
      ignore_watch: ['node_modules', 'cookies/*.json', 'reelgood.log', 'reel-shows.json', 'reelgood-titles.json'],
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
        ,DISABLE_INTERNAL_CORS: '1'
        ,TV_DATA_DIR: '/root/dev/apps/tv/data'
      }
    }
  ]
};
