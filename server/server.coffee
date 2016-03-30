
log = require('./utils') 'srvr'

process.on "uncaughtException", (err) ->
  log "Uncaught Exception: " + err
  
fs          = require 'fs-plus'
http        = require 'http'
nodeStatic  = require 'node-static'
SseChannel  = require 'sse-channel'
vlc         = require './vlc'
_           = require 'lodash'

channel = new SseChannel
  historySize:     1
  retryTimeout:  250
  pingInterval: 5000
  jsonEncode:    yes
  
lastStatus = null  

cfg = require("parent-config") "apps-config.json"
debug = (+cfg.tv_port is 2340)
log 'debug:', debug

require './ajax'
# require './tvdb'

dev  = (__dirname.indexOf('/dev/') > -1)
fileServer   = new nodeStatic.Server (if dev then cache: 0)
bannerServer = new nodeStatic.Server '/archive'

bundle = null
do loadBundle = ->
  bundle = fs.readFileSync 'js/bundle.js', 'utf8'
if dev
  fs.watchFile 'js/bundle.js', {interval: 100}, loadBundle


html = fs.readFileSync (if debug then 'client/index-dbg.html' else 'client/index.html')

srvr = http.createServer (req, res) ->
  # if not dev or req.url isnt '/js/bundle.js'
  # if req.url isnt '/js/bundle.js'
  #   log 'URL:', req.url
    
  done = (err, doc) ->
    res.writeHead (if err then 404 else 200), 'Content-Type': 'text/json'
    res.end JSON.stringify {err, doc}
    
  switch req.url
    when '/'
      res.writeHead 200, 'Content-Type': 'text/html'      
      res.end html
    when '/favicon.ico'
      res.writeHead 200, 'Content-Type': 'image/vnd.microsoft.icon'
      res.end fs.readFileSync 'server/images/favicon.ico'
      
    when '/channel'
      res.setHeader 'Transfer-Encoding', 'identity'
      log 'channel.addClient'
      lastStatus = null
      channel.addClient req, res, (err) ->
        lastStatus = null
        if err then log 'channel.addClient err:', err.message
      
    else 
      req.addListener('end', ->
        if req.url[0..13] is '/tvdb-banners/'
          bannerServer.serve req, res, (err) ->
            if err
              # if err.status isnt 404
              #   console.log 'banner 404:', req.url
              # else
                # console.log 'bannerServer BAD URL:', req.url, err
              done 'bannerServer BAD URL: ' + req.url
        else
          # log 'fileServer:', req.url
          fileServer.serve req, res, (err) ->
            if err and req.url[-4..-1] not in ['.map', '.ico', 'ined']
              # if err.status isnt 404
              #   console.log 'file 404:', req.url
              # else
                # console.log 'fileServer BAD URL:', req.url, err
              done 'fileServer BAD URL: ' + req.url
      ).resume()

do sendStatus = ->    
  vlc.status (err, status) ->
    # log 'vlc.status', {err, status}
    retry = ->
      lastStatus = null
      setTimeout sendStatus, 500
    if err then log 'sendStatus err: ', err; retry(); return
    else if status.busy then retry(); return
    else if not _.isEqual lastStatus, status
      lastStatus = status
      # log 'channel.send', status.file
      channel.send 
        event: 'status'
        id:     Date.now()
        data:   status
        retry:  3000
    
    setTimeout sendStatus, 1000
  
srvr.listen cfg.tv_port
log 'listening on port', cfg.tv_port


