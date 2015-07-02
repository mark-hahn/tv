
fs = require 'fs'
beefy = require("beefy")
http  = require("http")
log   = require('debug') 'tv:tvsrvr'
cfg   = require('parent-config') 'apps-config.json'

{CHROOT, USER, HOME_IP, AT_HOME, SERVER_IP, SERVER_HOST, DEBUG, LOCATION, OFF_SITE} = process.env
envStr = JSON.stringify {CHROOT, USER, HOME_IP, AT_HOME, SERVER_IP, SERVER_HOST, DEBUG, LOCATION, OFF_SITE}
src = fs.readFileSync 'client/utils.coffee', 'utf8'
src = src.replace /serverConfigStr\s=\s'.*?'/, "serverConfigStr = '" + envStr + "'"
fs.writeFileSync 'client/utils.coffee', src

env = {CHROOT, USER, HOME_IP, AT_HOME, SERVER_IP, SERVER_HOST, DEBUG, LOCATION, OFF_SITE}
log env

require './server-js/ajax'
require './server-js/video-proc'
require './server-js/video-srvr'

srvr = http.createServer beefy
  entries: '/client-app': 'client/app.coffee'
  cwd: __dirname
  live: true
  quiet: false
  bundlerFlags: [ 
    '-o', "bundle.js"
    "-t", "coffeeify"
    "--extension", ".coffee"
  ]
  
srvr.listen cfg.tv_port

log 'tv server listening on port ' + cfg.tv_port
