### 
  ajax-client.coffee 
###

log     = require('debug') 'tv:ajxcli'
request = require 'superagent'
 
# bug: these are for server, not client
{SERVER_HOST, DEBUG, OFF_SITE} = tvGlobal.serverConfig
 
tvGlobal.serverIp  = serverIp  = # 'hahnca.com'  # SERVER_HOST
tvGlobal.browserIp = browserIp = '192.168.1.103' #'hahnca.com'

tvGlobal.plexServerIp   = plexServerIp   = SERVER_HOST
tvGlobal.plexServerPort = plexServerPort =
  (if OFF_SITE isnt 'false' then '17179' else '32400')
tvGlobal.plexPfx  = "http://#{plexServerIp}:#{plexServerPort}"

tvGlobal.vidSrvrPort = vidSrvrPort = 
  (if OFF_SITE isnt 'false' then '1345' else '2345')
tvGlobal.vidSrvrPfx  = "http://#{serverIp}:#{vidSrvrPort}"
 
ajaxPort = +location.port + 4
ajaxPfx  = "http://#{serverIp}:#{ajaxPort}/"

request
  .get ajaxPfx + 'getIp'
  .set 'Content-Type', 'text/plain'
  .end (err, res) ->
    if res and res.status isnt 200
      log 'getIp bad status', res.status
      return
    if err
      log 'ajax err', err
      return
    tvGlobal.browserIp = JSON.parse(res.text).data
    log 'serverIp, browserIp', serverIp, browserIp

tvGlobal.ajaxCmd = (cmd, args..., cb) ->
  if cb? and typeof cb isnt 'function' then args.push cb
  query = ''
  sep = '?'
  for arg, idx in args when arg?
    query += sep + 'q' + idx + '=' +arg.toString()
    sep = '&'
    
  # if cmd isnt 'getTvStatus'
  #   log 'ajax call', {cmd, query, args}
  
  request
    .get ajaxPfx + cmd + query
    .set 'Content-Type', 'text/plain'
    .end (err, res) ->
      if res and res.status isnt 200
        log 'ajax result status err', res.status
        cb? res.status
        return
      if err
        log 'ajax err', err
        cb? err
        return
      cb? null, JSON.parse res.text

tvGlobal.ajaxLog = (args...) ->
  msg = args.join ', '
  console.log 'tvGlobal.log: ' + msg
  tvGlobal.ajaxCmd 'log', msg
