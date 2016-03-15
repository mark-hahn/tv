### 
  ajax-client.coffee 
###

log     = require('./debug') 'ajax'
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
      tvGlobal.serverIp = serverIp = '192.168.1.103'
    else
      tvGlobal.serverIp = serverIp = 'hahnca.com'
      
    tvGlobal.srvrPort    = srvrPort    = +location.port
    tvGlobal.vidSrvrPort = vidSrvrPort = srvrPort + 5
    ajaxPort                           = srvrPort + 4
    tvGlobal.bannerPfx   = bannerPfx = "http://#{serverIp}:#{srvrPort}/tvdb-banners/"
    tvGlobal.vidSrvrPfx  = vidSrvrPfx = "http://#{serverIp}:#{vidSrvrPort}"
    ajaxPfx              = "http://#{serverIp}:#{ajaxPort}/"
    
    tvGlobal.ajaxInit = yes
    # log 'init', {browserIp, serverIp, vidSrvrPfx, ajaxPfx, bannerPfx}

tvGlobal.ajaxCmd = (cmd, args..., cb) ->
  # log 'ajaxCmd', cmd, args
  if not tvGlobal.ajaxInit
    log 'not tvGlobal.ajaxInit'
    setTimeout (-> tvGlobal.ajaxCmd cmd, args..., cb), 100
    return
  if cb? and typeof cb isnt 'function' then args.push cb
  query = ''
  sep = '?'
  for arg, idx in args when arg?
    query += sep + 'q' + idx + '=' +arg.toString()
    sep = '&'
    
  # log 'ajax called', {cmd, args}
  
  request
    .get ajaxPfx + cmd + query
    .set 'Content-Type', 'text/plain'
    .end (err, res) ->
      if res and res.status isnt 200
        log 'ajax result status err:', res.status, cmd, query
        cb? res.status
        return
      if err
        log 'ajax err:', cmd, query, err
        cb? err
        return
      # log 'ajax returned', cmd
      cb? null, JSON.parse res.text

tvGlobal.ajaxLog = (args...) ->
  msg = args.join ', '
  console.log 'tvGlobal.log: ' + msg
  tvGlobal.ajaxCmd 'log', msg
