### 
  ajax-client.coffee 
###

log     = require('debug') 'tv:ajxcli'
request = require 'superagent'

ajaxPort = ajaxPfx = null

request
  .get 'http://icanhazip.com'
  .set 'Content-Type', 'text/plain'
  .end (err, res) ->
    if res and res.status isnt 200
      log 'icanhazip bad status', res.status
      return
    if err
      log 'icanhazip err', err
      return
    tvGlobal.browserIp = browserIp = res.text[0..12]
    
    if browserIp is '173.58.39.204'
      tvGlobal.atHome = atHome = yes
      tvGlobal.serverIp = serverIp = '192.168.1.103'
    else
      tvGlobal.atHome = atHome = no
      tvGlobal.serverIp = serverIp = 'hahnca.com'
      
    tvGlobal.vidSrvrPort = vidSrvrPort = 
      (if atHome isnt 'false' then '2345' else '1345')
    tvGlobal.vidSrvrPfx  = vidSrvrPfx = "http://#{serverIp}:#{vidSrvrPort}"
    ajaxPort = +location.port + 4
    ajaxPfx  = "http://#{serverIp}:#{ajaxPort}/"
    tvGlobal.ajaxInit = yes
    log 'init', {browserIp, atHome, serverIp, vidSrvrPfx, ajaxPfx}

tvGlobal.ajaxCmd = (cmd, args..., cb) ->
  if not tvGlobal.ajaxInit
    setTimeout (-> tvGlobal.ajaxCmd cmd, args..., cb), 100
    return
  if cb? and typeof cb isnt 'function' then args.push cb
  query = ''
  sep = '?'
  for arg, idx in args when arg?
    query += sep + 'q' + idx + '=' +arg.toString()
    sep = '&'
    
  if cmd isnt 'getTvStatus'
    log 'ajax call', {cmd, query, args}
  
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
