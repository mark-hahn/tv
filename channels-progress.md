badGroups: apps/client/src/srvr.js, apps/client/src/components/tor.vue, apps/srvr/src/messaging.js, apps/srvr/index.js
badGroups validated: apps/client build, apps/srvr node --check
qbtInfo source: packages/share/src/channelPeer.js, apps/srvr/src/messaging.js, apps/api/src/server.js
qbtInfo source validated: apps/api node --check
qbtInfo client: apps/client/src/components/App.vue, apps/client/src/components/qbt.vue
qbtInfo client validated: apps/client build
chksrt: apps/srvr/index.js, apps/client/src/components/App.vue
browseHasMore: apps/api/src/server.js, apps/client/src/components/App.vue
badge channels validated: apps/client build, apps/srvr/apps/api node --check
lastViewed: apps/srvr/src/lastViewed.js, apps/srvr/index.js, apps/client/src/srvr.js
lastViewed validated: apps/client build, apps/srvr node --check
flexget: apps/srvr/src/flexget.js, apps/srvr/index.js, apps/client/src/components/flex.vue
flexget validated: apps/client build, apps/srvr node --check
downloads/movieDownloads: apps/down/src/main.js, apps/client/src/components/down.vue
downloads/movieDownloads validated: apps/client build, apps/down node --check
tvPicture/embyPlaying: apps/tv/src/main.js, apps/client/src/components/tvpane.vue
tvPicture/embyPlaying validated: apps/client build, apps/tv node --check
android parity: apps/android/App.js
final local validation: node --check all touched servers, unilog/check all, apps/client build
deployed: srvr, api, down, tv
pm2 verified: touched apps online, recent logs empty
post-deploy validation: node --check all touched servers, unilog/check all, apps/client build
