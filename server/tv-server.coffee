
beefy = require("beefy")
http  = require("http")
log   = require('debug') 'tv:tsrv'
require './ajax'

log 'starting tv beefy'

http.createServer(beefy(
  entries: [ "../client/app.coffee" ]
  cwd: __dirname
  live: true
  quiet: false
  bundlerFlags: [ 
    '-o', "bundle.js"
    "-t", "coffeeify"
    "--extension", ".coffee"
  ]
  
)).listen 1340
