
beefy = require("beefy")
http = require("http")
require './ajax'

console.log 'starting tv beefy'

http.createServer(beefy(
  entries: [ "../src/app.coffee" ]
  cwd: __dirname
  live: true
  quiet: false
  bundlerFlags: [ 
    '-o', "bundle.js"
    "-t", "coffeeify"
    "--extension", ".coffee"
  ]
  
)).listen 1340
