###
  src/plex.coffee
###

net = require 'net'
log = require('debug') 'tv:-ir-'

itachHost = '192.168.1.18'

irDataByCmd =
  muteCmd:   '1,40000,1,1,96,24,24,24,24,24,48,24,24,24,48,24,24,24,24,24,48,24,24,24,24,24,24,24,24,' +
             '1058 ","0000 0068 0000 000d 0060 0018 0018 0018 0018 0018 0030 0018 0018 0018 0030 0018 0018 0018 0018 0018 0030 0018 0018 0018 0018 0018 0018 0018 0018 0422'
  volUpCmd:  '2445,40000,1,1,4,5,6,5'
  volDnCmd:  '2445,40000,1,1,4,5,6,5'
  offCmd:    '2445,40000,1,1,4,5,6,5'

itach = null
sendToItach = (irData, cb) ->
  # itach.write 'getdevices' + '\r', 'utf8', (err) ->
  itach.write 'sendir,1:1,' + irData + '\r', 'utf8', (err) ->
    if err then log 'write err', err.message; cb err
    cb()

sendIR = (irData, cb) ->
  
  endSendIR = (err, data) ->
    if timeout then clearTimeout timeout
    timeout = null
    if data?[-1..-1][0] is '\r' then data = data[0..-2]
    if data then log data
    if err then err = message: err
    cb? err, data
    cb = null
    
  timeout = setTimeout ->
    endSendIR 'sendIR timeout: + irData'
  , 3000
  
  if not itach
    itach = net.createConnection {host:itachHost, port:4998}, (err) ->
      if err then endSendIR 'connect err: ' + err.message;  return
      sendToItach irData, (err) ->
        if err then endSendIR 'sendToItach err: ' + err.message;  return
      
    itach.on 'data', (data) ->
      data = data.toString().replace /\r\n?/g, '\n'
      # log 'data', data
      if data[0..14] is 'completeir,1:1,'
        endSendIR null, data
        return
      log 'itach data isnt "completeir,1:1,"'
      
    itach.on 'end', (err) ->
      if err then endSendIR 'end err: ' + err.message;  return
      log 'itach end'
      endSendIR null, ''
    return
      
  sendToItach irData, (err) ->
    if err then endSendIR 'sendToItach err: ' + err.message; return
    endSendIR null, ''

exports.sendCmd = (cmd, cb) ->
  sendIR irDataByCmd[cmd], (err, data) ->
    if err or data[0..2] is 'ERR' 
      endSendIR 'sendIR err: ' + (err?.message ? data); return
    # log 'sendIR result: ' + data
    cb()
     
exports.sendCmd 'muteCmd', (err) ->
  if err then log 'sendCmd err', err.message; cb err
