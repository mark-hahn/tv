
util    = require 'util'
url     = require 'url'
http    = require 'http'
exec    = require('child_process').exec
ir      = require './ir'
insteon = require './insteon'
db      = require './db'
log     = require('debug') 'tv:ajax'
port    = require('parent-config')('apps-config.json').tvAjax_port
log 'port', port

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
  # if req.url isnt '/getTvStatus'
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
      # console.log 'tvGlobal.log: ' + data.join ', '
      success res
      
    when 'getIp'
      originIp = req.connection.remoteAddress.split ':'
      originIp = originIp[originIp.length-1]
      success res, originIp
      
    when 'shows'
      db.getShowList (err, result) ->
        if err then error res, err.message; return
        success res, result
    
    when 'setDBField'
      # log 'setDBField', data
      val = switch data[2]
        when 'true'  then true
        when 'false' then false
        else data[1]
      db.setField data[0], data[1], val, (err, doc) ->
        if err then error res, err.message; return
        success res, 'done'

    when 'turnOn'
      db.syncPlexDB()
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
    
    when 'startTv'
      log 'startRoku', {plexRunningInRoku, data}
      # if not plexRunningInRoku
      #   error res, 'plexNotRunning' + req.url
      # roku.startVideo data[0], (data[1] is 'goToStart')
      success res, ''
      
    when 'pauseTv'
      log 'pauseRoku', {plexRunningInRoku}
      # roku.playAction 'pause'
      success res, ''
      
    when 'skipFwdTv'
      log 'skipFwdTv', {plexRunningInRoku}
      # roku.playAction 'skipNext'
      success res, ''
      
    when 'skipBackTv'
      log 'skipBackTv', {plexRunningInRoku}
      # roku.playAction 'skipPrevious'
      success res, ''
      
    when 'backTv'
      log 'backRoku', {plexRunningInRoku}
      # roku.playAction 'stepBack'
      success res, ''
      
    when 'stopTv'
      # log 'stopRoku', {plexRunningInRoku}
      # db.syncPlexDB()
      # roku.playAction 'stop'
      success res, ''
      
    when 'syncPlexDB'
      # db.syncPlexDB()
      success res, ''
        
    when 'getTvStatus'
      # plex.getStatus (err, playStatus) ->
        # log 'getTvStatus', {err, playStatus}
        # if err then error res, 'getTvStatus err: ' + err.message; return
        success() # res, playStatus

    when 'usbconfig'
      # exec 'ssh xobtlu@37.48.119.77 sed -n "/^\\ \\ \\ \\ \\ \\ \\-/p" config.yml |
      exec 'ssh mcstorm@95.211.211.205 sed -n "/^\\ \\ \\ \\ \\ \\ \\-/p" config.yml |
                                       sed "s/^\\ \\ \\ \\ \\ \\ \\-\\ //" | 
                                       sed /rss:/d', (err, stdout, stderr) ->
        if err then error res, 'usbconfig err: ' + err.message; return
        # log 'usbconfig', {err, stdout, stderr}                
        success res, stdout.split '\n'
      
    else
      error res, 'bad request cmd: ' + req.url + ',' + pathname, 400

srvr.listen port
log 'tv ajax listening on port ' + port
