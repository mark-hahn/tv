
log      = require('debug') 'tv:ajax'

util     = require 'util'
url      = require 'url'
http     = require 'http'
exec     = require('child_process').exec
ir       = require './ir'
insteon  = require './insteon'
db       = require './db'
port     = require('parent-config')('apps-config.json').tvAjax_port
showList = require './show-list'
vlc      = require './vlc'

poweringUp = no

srvr = http.createServer (req, res) ->
  if req.url isnt '/getPlayInfo'
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
      console.log 'tvGlobal.log: ' + data.join ', '
      success ''
      
    when 'shows'
      log 'shows start'
      showList.getShowList (err, result) ->
        if err then error err.message; return
        # log 'shows done', result.length
        success result
    
    when 'getPlayInfo'
      vlc.getPlayInfo (err, args...) ->
        if err then error err.message; return
        success args
    
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
    
    when 'startVlc'
      log 'startVlc'
      vlc.play data...
      success ''
      
    when 'playPauseVlc'
      log 'playPauseVlc'
      vlc.pause()
      success ''
      
    when 'seekVlc'
      log 'seekVlc', data
      vlc.seek data
      success ''
      
    when 'volupVlc'
      log 'volupVlc'
      vlc.volinc +10
      success ''
      
    when 'voldownVlc'
      log 'voldownVlc'
      vlc.volinc -10
      success ''
      
    when 'toggleMuteVlc'
      log 'toggleMuteVlc'
      vlc.toggleMute()
      success ''
      
    when 'nosubVlc'
      log 'nosubVlc'
      vlc.nosub()
      success ''
      
    when 'skipFwdVlc'
      log 'skipFwdVlc'
      success ''
      
    when 'skipBackVlc'
      log 'skipBackVlc'
      success ''
      
    when 'backVlc'
      log 'backVlc'
      success ''
      
    when 'stopVlc'
      vlc.stop()
      success ''
      
    when 'syncPlexDB'
      # db.syncPlexDB()
      success ''
        
    when 'usbconfig'
      exec 'ssh xobtlu@37.48.119.77 sed -n "/^\\ \\ \\ \\ \\ \\ \\-/p" config.yml |
                                       sed "s/^\\ \\ \\ \\ \\ \\ \\-\\ //" | 
                                       sed /rss:/d', (err, stdout, stderr) ->
        if err then error 'usbconfig err: ' + err.message; return
        log 'usbconfig', {err, stdout, stderr}                
        success stdout.split '\n'
      
    else
      error 'bad request cmd: ' + req.url + ',' + pathname, 400

srvr.listen port
log 'tv ajax listening on port ' + port
