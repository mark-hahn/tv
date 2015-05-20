###
  src/ir.coffee
###

net = require 'net'
log = require('debug') 'tv:-ir-'

itachHost = '192.168.1.18'

# for standard sony tv remote
irPfx1 = 'sendir,1:1,'
irPfx2 = ',40000,1,1,'
irSfx  = ',24,24,24,24,24,24'
irDataByCmd =
  hdmi1:  '24,24,24,24,24,24,24,48,24,24,24,24,24,48,24,48,24,24' # BD Home Theatre
  hdmi2:  '24,48,24,24,24,24,24,48,24,24,24,24,24,48,24,48,24,24' # Chromecast
  hdmi3:  '24,24,24,24,24,48,24,48,24,48,24,24,24,48,24,24,24,48,24,24,24,48,24,48' # DVR
  hdmi4:  '24,48,24,24,24,48,24,48,24,48,24,24,24,48,24,24,24,48,24,24,24,48,24,48' # Roku
  pwrOff: '24,48,24,48,24,48,24,48,24,24,24,48,24,24,24,48,24,24'
  pwrOn:  '24,24,24,48,24,48,24,48,24,24,24,48,24,24,24,48,24,24'
  volUp:  '24,24,24,48,24,24,24,24,24,48,24,24,24,24,24,48,24,24'
  volDn:  '24,48,24,48,24,24,24,24,24,48,24,24,24,24,24,48,24,24'
  mute:   '24,24,24,24,24,48,24,24,24,48,24,24,24,24,24,48,24,24'

idCount = 0
itach = timeout = null

writeToItach = (irData, cb) ->
  idCount = ++idCount % 6553
  data = '96,' + irData + irSfx
  itach.write irPfx1 + idCount + irPfx2 + data + ',1035,' + data + ',1035,' + data + ',4000\r', \
              'utf8', (err) ->
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
  if not (code = ['hdmi1','hdmi2','hdmi3','hdmi4','pwrOff'][i++]) 
    log 'finished'
    process.exit()
  log 'sending ' + code
  exports.sendCmd code, (err) ->
    if err then log 'sendCmd err: ', err.message; process.exit()
    else setTimeout one, 2000
      
      