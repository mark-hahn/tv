
fs   = require 'fs'
http = require 'http'
url  = require 'url'
log  = require('debug') 'tv:vidsrv'
cfg  = require('parent-config') 'apps-config.json'

size = null # DEBUG

srvr = http.createServer (req, res) ->
  # log req.headers.range + ' ' + req.url
  haveRange = req.headers.range?
  # if not haveRange then log 'no range', req.headers
  
  file      = '/mnt/media/videos-small' + req.url
  range     = req.headers.range ?= 'bytes=0'
  positions = range.replace('bytes=', '').split('-')
  
  fs.stat file, (err, stats) ->
    if not stats
      log 'Missing file', file
      res.writeHead 404, 'Content-Type':  'text/plain'
      res.end 'No such file: ' + file
      return
      
    # if not size then log size = stats.size # DEBUG
    
    start   = +(positions[0]                )
    end     = +(positions[1] or stats.size-1)
    total   = stats.size
    contLen = (end - start) + 1
    
    if haveRange 
      res.writeHead 206,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + total
        'Accept-Ranges': 'bytes'
        'Content-Length': contLen
        'Content-Type':  'video/mp4'
    else
      res.writeHead 200,
        'Content-Length': contLen
        'Content-Type':  'video/mp4'

    stream = fs.createReadStream file, {start, end}
      .on 'open',        -> stream.pipe res
      .on 'error', (err) -> res.end err
      
srvr.listen cfg.tvVidSrvr_port

log 'video server listening on port ' + cfg.tvVidSrvr_port
