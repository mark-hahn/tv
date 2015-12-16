
util     = require 'util'
url      = require 'url'
http     = require 'http'
exec     = require('child_process').exec
ir       = require './ir'
insteon  = require './insteon'
db       = require './db'
log      = require('debug') 'tv:ajax'
port     = require('parent-config')('apps-config.json').tvAjax_port
showList = require './show-list'

db.init   (err) -> if err then log 'db.init failed'
 
poweringUp = no

srvr = http.createServer (req, res) ->
  if req.url isnt '/getTvStatus'
    log 'ajax http req: ' + req.url

  error = (msg, code=500) ->
    log 'ajax error: ' +  msg
    res.writeHead code, 
      'Content-Type': 'text/plain'
      'Access-Control-Allow-Origin': '*'
    res.end JSON.stringify err: msg, status: code

  success = (data) ->
    res.writeHead 200, 
      'Content-Type': 'text/json'
      'Access-Control-Allow-Origin': '*'
    result = status: 200
    if data then result.data = data
    res.end JSON.stringify result
  
  {pathname, query} = url.parse req.url, true
  data = []
  for q, arg of query
    data[q[1]] = decodeURI arg
  
  switch pathname[1..]

    when 'log'
      # console.log 'tvGlobal.log: ' + data.join ', '
      success ''
      
    when 'shows'
      log 'shows start'
      showList.getShowList (err, result) ->
        if err then error err.message; return
        log 'shows done', result.length
        success result
    
    when 'setDBField'
      log 'setDBField', data
      val = switch data[2]
        when 'true'  then true
        when 'false' then false
        else data[1]
      db.setField data[0], data[1], val, (err, doc) ->
        if err then error err.message; return
        success 'done'

    when 'turnOn'
      db.syncPlexDB()
      if poweringUp then success 'skipped'; return
      poweringUp = yes
      ir.sendCmd 'pwrOn', (err) ->
        if err then error err.message; poweringUp = no; return
        setTimeout ->
          ir.sendCmd 'hdmi2', (err) ->
            poweringUp = no
            if err then error err.message; return
            success 'done'
        , 15000
        
    when 'irCmd'
      if poweringUp then success 'skipped'; return
      ir.sendCmd data..., (err) ->
        if err then error err.message; return
        success 'sent'

    when 'lightCmd'
      try
        insteon.lightCmd data...
        success ''
      catch e
        error 'invalid lightCmd URL' + req.url
        
    when 'getLightLevels'
      insteon.getLightLevels (err, lightLevels) ->
        if err then error 'getAllLights err: ' + err.message; return
        success lightLevels
    
    when 'startTv'
      log 'startRoku', {plexRunningInRoku, data}
      # if not plexRunningInRoku
      #   error 'plexNotRunning' + req.url
      # roku.startVideo data[0], (data[1] is 'goToStart')
      success ''
      
    when 'pauseTv'
      log 'pauseRoku', {plexRunningInRoku}
      # roku.playAction 'pause'
      success ''
      
    when 'skipFwdTv'
      log 'skipFwdTv', {plexRunningInRoku}
      # roku.playAction 'skipNext'
      success ''
      
    when 'skipBackTv'
      log 'skipBackTv', {plexRunningInRoku}
      # roku.playAction 'skipPrevious'
      success ''
      
    when 'backTv'
      log 'backRoku', {plexRunningInRoku}
      # roku.playAction 'stepBack'
      success ''
      
    when 'stopTv'
      # log 'stopRoku', {plexRunningInRoku}
      # db.syncPlexDB()
      # roku.playAction 'stop'
      success ''
      
    when 'syncPlexDB'
      # db.syncPlexDB()
      success ''
        
    when 'getTvStatus'
      # plex.getStatus (err, playStatus) ->
        # log 'getTvStatus', {err, playStatus}
        # if err then error 'getTvStatus err: ' + err.message; return
        success '' # playStatus

    when 'usbconfig'
      # exec 'ssh xobtlu@37.48.119.77 sed -n "/^\\ \\ \\ \\ \\ \\ \\-/p" config.yml |
      exec 'ssh mcstorm@95.211.211.205 sed -n "/^\\ \\ \\ \\ \\ \\ \\-/p" config.yml |
                                       sed "s/^\\ \\ \\ \\ \\ \\ \\-\\ //" | 
                                       sed /rss:/d', (err, stdout, stderr) ->
        if err then error 'usbconfig err: ' + err.message; return
        # log 'usbconfig', {err, stdout, stderr}                
        success stdout.split '\n'
      
    else
      error 'bad request cmd: ' + req.url + ',' + pathname, 400

srvr.listen port
log 'tv ajax listening on port ' + port
