
fs = require 'fs'
beefy = require("beefy")
http  = require("http")
log   = require('debug') 'tv:srvr'
cfg   = require('parent-config') 'apps-config.json'

src = fs.readFileSync 'client/app.coffee', 'utf8'
src.replace /tvGlobal.ajaxPort.=.\d+/, 'tvGlobal.ajaxPort = ' + cfg.tvAjax_port
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
