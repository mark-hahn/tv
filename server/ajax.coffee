
util    = require 'util'
url     = require 'url'
http    = require 'http'
ir      = require './ir'
roku    = require './roku'
insteon = require './insteon'
db      = require './db'
log     = require('debug') 'tv:ajax'
port    = require('parent-config')('apps-config.json').tvAjax_port

roku.init (err) -> if err then log 'roku.init failed'
db.init   (err) -> if err then log 'db.init failed'

error = (res, msg, code=500) ->
  log 'ajax error: ' +  msg
  if res
    res.writeHead code, 
      'Content-Type': 'text/plain'
      'Access-Control-Allow-Origin': '*'
    res.end JSON.stringify err: msg, status: code

success = (res, data) ->
  if res
    res.writeHead 200, 
      'Content-Type': 'text/json'
      'Access-Control-Allow-Origin': '*'
    result = status: 200
    if data then result.data = data
    res.end JSON.stringify result
  
poweringUp = no

srvr = http.createServer (req, res) ->
  # log 'ajax http req: ' + req.url
  
  res.writeHead 200, 
    'Content-Type': 'text/json'
    'Access-Control-Allow-Origin': '*'
    
  {pathname, query} = url.parse req.url, true
  data = []
  for q, arg of query
    data[q[1]] = decodeURI arg
  
  switch pathname[1..]

    when 'log'
      console.log 'tvGlobal.log: ' + data.join ', '
      success res
      
    when 'shows'
      db.getShowList (err, result) ->
        if err then error res, err.message; return
        success res, result
    
    when 'turnOn'
      if poweringUp then success res, 'skipped'; return
      poweringUp = yes
      ir.sendCmd 'pwrOn', (err) ->
        if err then error res, err.message; poweringUp = no; return
        setTimeout ->
          ir.sendCmd 'hdmi2', (err) ->
            poweringUp = no
            if err then error res, err.message; return
            success res, 'done'
        , 15000
        
    when 'irCmd'
      # log 'ajax irCmd', data
      if poweringUp then success res, 'skipped'; return
      ir.sendCmd data..., (err) ->
        if err then error res, err.message; return
        success res, 'sent'

    when 'lightCmd'
      try
        insteon.lightCmd data...
        success res
      catch e
        error res, 'invalid lightCmd URL' + req.url
        
    when 'getLightLevels'
      insteon.getLightLevels (err, lightLevels) ->
        if err then error res, 'getAllLights err: ' + err.message; return
        success res, lightLevels
    
    when 'startVideo'
      log 'startVideo', data
      roku.startVideo data[0], +data[1]
        
    else
      error res, 'bad request cmd: ' + req.url + ',' + pathname, 400

srvr.listen port
log 'tv ajax listening on port ' + port
