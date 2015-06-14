
fs = require 'fs'
beefy = require("beefy")
http  = require("http")
log   = require('debug') 'tv:srvr'
cfg   = require('parent-config') 'apps-config.json'

src = fs.readFileSync 'client/app.coffee', 'utf8'
src = src.replace /serverIp\s=\s'.*?'/,     "serverIp = '"     + cfg.server_ip   + "'"
src = src.replace /plexServerIp\s=\s'.*?'/, "plexServerIp = '" + cfg.plex_server + "'"
src = src.replace /ajaxPort\s=\s\d+/,       "ajaxPort = "      + cfg.tvAjax_port
fs.writeFileSync 'client/app.coffee', src

require './server-js/ajax'

http.createServer(beefy(
  entries: '/client-app': 'client/app.coffee'
  cwd: __dirname
  live: true
  quiet: false
  bundlerFlags: [ 
    '-o', "bundle.js"
    "-t", "coffeeify"
    "--extension", ".coffee"
  ]
  
)).listen cfg.tv_port
log 'tv app  listening on port ' + cfg.tv_port
