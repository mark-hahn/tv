###
  src/ir.coffee
###

net = require 'net'
log = require('debug') 'tv:-ir-'

itachHost = '192.168.1.18'

# for standard sony tv (tested on KDL-60R520A, remote RM-YD096)
irDataByCmd =
  mute:   '96,24,24,24,24,24,48,24,24,24,48,24,24,24,24,24,48,24,24,24,24,24,24,24,24'
  pwrTog: '96,24,48,24,24,24,48,24,24,24,48,24,24,24,24,24,48,24,24,24,24,24,24,24,24'
  volUp:  '96,24,24,24,48,24,24,24,24,24,48,24,24,24,24,24,48,24,24,24,24,24,24,24,24'
  volDn:  '96,24,48,24,48,24,24,24,24,24,48,24,24,24,24,24,48,24,24,24,24,24,24,24,24'

idCount = 0
itach = timeout = null

writeToItach = (irData, cb) ->
  idCount = ++idCount % 6553
  itach.write 'sendir,1:1,' + idCount + ',40000,10,1,' + 
              irData + ',1035,' + irData + ',1035,' + irData + ',4000\r', 'utf8', (err) ->
    if err then log 'write err: ' + err.message; cb err; return
    cb()

sendIR = (irData, cb) ->
  
  endSendIR = (err, data) ->
    if timeout then clearTimeout timeout
    timeout = null
    # if data then log 'endSendIR data: ' + data
    if err then err = message: err
    if not cb then console.trace()
    cb? err, data
    # cb = null
    
  timeout = setTimeout (-> endSendIR 'sendIR timeout'), 3000

  if not itach
    itach = net.createConnection {host:itachHost, port:4998}, (err) ->
      if err then endSendIR 'connect err: ' + err.message;  return
      writeToItach irData, (err) ->
        if err then endSendIR 'writeToItach err: ' + err.message;  return
      
    itach.on 'data', (data) ->
      data = data.toString().replace /\r\n?/g, '\n'
      if data?[-1..-1][0] is '\n' then data = data[0..-2]
      # log 'data', data
      parts = /^(.{15})(\d+)$/.exec data
      if parts and parts[1] is 'completeir,1:1,' and +parts[2] is idCount
        endSendIR null, data
        return
      log 'itach data error: ' + idCount + ', ' + data
      
    itach.on 'end', (err) ->
      if err then endSendIR 'end err: ' + err.message;  return
      log 'itach end'
      endSendIR()
    return
      
  writeToItach irData, (err) ->
    if err 
      endSendIR 'writeToItach err: ' + err.message
      return

exports.sendCmd = (cmd, cb) ->
  sendIR irDataByCmd[cmd], (err, data) ->
    if err or data[0..2] is 'ERR' 
      log 'sendIR err: ' + (err?.message ? data); cb err; return
    # log 'sendIR result: ' + data
    cb()

i = 0
do one = ->
  # log 'start'
  exports.sendCmd 'volUp', (err) ->
    if err then log 'sendCmd err: ', err.message
    else 
      log 'finish'
      if ++i < 1 then one()
      else process.exit()
    
    