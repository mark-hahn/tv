
log = (args...) -> console.log 'SERVR:', args...

fs          = require 'fs-plus'
http        = require 'http'
nodeStatic  = require 'node-static'
 
cfg = require("parent-config") "apps-config.json"

if +cfg.tv_port is 1340
  log "starting video processing"
  require "./video-proc"
  
require './ajax'
require './video-srvr'

dev  = (__dirname.indexOf('/dev/') > -1)
fileServer = new nodeStatic.Server (if dev then cache: 0)

bundle = null
do loadBundle = ->
  # log 'loading bundle'
  bundle = fs.readFileSync 'js/bundle.js', 'utf8'
  bundleChanged = yes
if dev
  fs.watchFile 'js/bundle.js', {interval: 100}, loadBundle
bundleChanged = no

html = fs.readFileSync 'client/index.html'

srvr = http.createServer (req, res) ->
  if not dev or (
       req.url.indexOf('favicon') is -1 and 
       req.url isnt '/js/bundle.js')
    log 'URL:', req.url
    
  done = (err, doc) ->
    res.writeHead (if err then 404 else 200), 'Content-Type': 'text/json'
    res.end JSON.stringify {err, doc}
    
  switch req.url
    
    when '/'
      res.writeHead 200, 'Content-Type': 'text/html'      
      res.end html
    
    else
      req.addListener('end', ->
        if req.url[0..5] is '/data/'
          req.url = req.url[6...]
          dataServer.serve req, res, (err) ->
            if err
              console.log 'data file not found: ' + req.url, err
              done 'data file not found: ' + req.url
              return
        else
          fileServer.serve req, res, (err) ->
            if err and req.url[-4..-1] not in ['.map', '.ico', 'ined']
              console.log 'fileServer BAD URL:', req.url, err
              done 'fileServer BAD URL: ' + req.url
              return
      ).resume()

srvr.listen cfg.tv_port
log 'tv server listening on port ' + cfg.tv_port


