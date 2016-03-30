### 
  ajax-client.coffee 
### 
 
log     = require('./debug') 'ajax'
request = require 'superagent'

tvGlobal = window.tvGlobal
tvGlobal.bannerPfx   = "http://hahnca.com/#{tvGlobal.base}/tvdb-banners/"
ajaxPfx              = "http://hahnca.com/#{tvGlobal.base}-ajax/"

tvGlobal.ajaxCmd = (cmd, args..., cb) ->
  # log 'ajaxCmd', cmd, args
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
