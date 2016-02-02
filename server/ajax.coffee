
log = require('./utils') 'ajax'

util     = require 'util'
url      = require 'url'
http     = require 'http'
exec     = require('child_process').exec
ir       = require './ir'
db       = require './db'
port     = require('parent-config')('apps-config.json').tvAjax_port
showList = require './show-list'
vlc      = require './vlc'

poweringUp = no

srvr = http.createServer (req, res) ->
  # log 'ajax http req: ' + req.url

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
      # log 'shows start'
      showList.getShowList (err, result) ->
        if err then error err.message; return
        # log 'shows done', result.length
        success result
    
    when 'setDBField'
      # log 'setDBField', data
      val = switch data[2]
        when 'true'  then true
        when 'false' then false
        else data[2]
      db.setField data[0], data[1], val, (err, doc) ->
        if err then error err.message; return
        success 'done'

    when 'power'
      ir.sendCmd 'power', (err) ->
        if err then error err.message; return
        
    when 'irCmd'
      if poweringUp then success 'skipped'; return
      ir.sendCmd data..., (err) ->
        if err then error err.message; return
        success 'sent'

    when 'vlcCmd'
      # log 'vlcCmd', data
      vlc[data[0]] data[1..]...
      success ''
      
    when 'syncPlexDB'
      # db.syncPlexDB()
      success ''
        
    when 'usbconfig'
      exec 'ssh xobtlu@37.48.119.77 sed -n "/^\\ \\ \\ \\ \\ \\ \\-/p" config.yml |
                                       sed "s/^\\ \\ \\ \\ \\ \\ \\-\\ //" | 
                                       sed /rss:/d', (err, stdout, stderr) ->
        if err then error 'usbconfig err: ' + err.message; return
        # log 'usbconfig', {err, stdout, stderr}                
        success stdout.split '\n'
      
    else
      error 'bad request cmd: ' + req.url + ',' + pathname, 400

srvr.listen port
log 'tv ajax listening on port ' + port
