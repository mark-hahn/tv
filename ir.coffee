,24,24,24,48,24,24###
  src/ir.coffee
###

###
esp8266 ...
  mod: 35.2 KHz
  hdr: 2.4 ms
  1: 1200 us
  0: 600 us
  bit gap: 600us   24/4 * 100us   0.6 ms
  data gap: s.b. 1035/4 * 100us  25.9 ms
  send gap: s.b. 4000/4 * 100us 100.0 ms
###

net = require 'net'
log = require('./utils') '  IR'

###
Nmap scan report for 192.168.1.236
Host is up (0.17s latency).
MAC Address: 00:0C:1E:03:6A:7E (Global Cache)
###
itachHost = '192.168.1.236'

# for standard sony tv remote
irPfx1 = 'sendir,1:1,'
irPfx2 = ',40000,1,1,'
irSfx  = ',24,24,24,24,24,24'  # 000
irDataByCmd =
  power:  '24,48,24,24,24,48,24,24,24,48,24,24,24,24, 24,48,24,24'  # 1010 1001 0000  A90
  pwrOff: '24,48,24,48,24,48,24,48,24,24,24,48,24,24, 24,48,24,24'
  pwrOn:  '24,24,24,48,24,48,24,48,24,24,24,48,24,24, 24,48,24,24'
  volUp:  '24,24,24,48,24,24,24,24,24,48,24,24,24,24, 24,48,24,24'
  volDn:  '24,48,24,48,24,24,24,24,24,48,24,24,24,24, 24,48,24,24'
  mute:   '24,24,24,24,24,48,24,24,24,48,24,24,24,24, 24,48,24,24'
  hdmi1:  '24,24,24,24,24,24,24,48,24,24,24,24,24,48, 24,48,24,24' # BD Home Theatre
  hdmi2:  '24,48,24,24,24,24,24,48,24,24,24,24,24,48, 24,48,24,24' # Chromecast
  hdmi3:  '24,24,24,24,24,48,24,48,24,48,24,24,24,48, 24,24,24,48,24,24,24,48,24,48' # tv pc
  hdmi4:  '24,48,24,24,24,48,24,48,24,48,24,24,24,48, 24,24,24,48,24,24,24,48,24,48' # Roku
# power 1010100 10000    12-bit
# roku  1011101 01011000 15-bit

# power addr=1  cmd=21, sony lsb-first, 7-bit cmd, 5-bit addr
# 1010 1001 0000 000, hdr+data gap, data, gap, data  

# roku  addr=26 cmd=91, sony lsb-first, 7-bit cmd, 8-bit addr

idCount = 0
itach = timeout = null

writeToItach = (irData, cb) ->
  idCount = ++idCount % 65536
  data = '96,' + irData + irSfx
  # log 'itach write', irPfx1 + idCount + irPfx2 + data + ',1035,' + data + ',1035,' + data + ',4000'

  itach.write irPfx1 + idCount + irPfx2 + data + ',1035,' + data + ',1035,' + data + ',4000\r', \
              'utf8', (err) ->
    if err then log 'write err: ' + err.message; cb err; return
    cb()

sendIrCb = null

# not re-entrant
sendIR = (irData, cb) ->
  # log 'sendIR enter (not re-entrant)', irData
  sendIrCb = cb

  endSendIR = (err, data) ->
    if timeout then clearTimeout timeout
    timeout = null
    if data then log 'endSendIR data: ' + data[0..80]
    if err
      # log 'endSendIR err', err.message
      err = message: err
    sendIrCb? err, data
    sendIrCb = null
    # log 'sendIR exit 0 (endSendIR)', data


  timeout = setTimeout (-> endSendIR 'sendIR timeout'), 3000

  if not itach
    # log 'itach createConnection'
    itach = net.createConnection {host:itachHost, port:4998}, (err) ->
      log 'itach createConnection res:', err
      if err then endSendIR 'connect err: ' + err.message;  return
      writeToItach irData, (err) ->
        if err then endSendIR 'writeToItach err: ' + err.message;  return
    itach.setTimeout 0
    itach.on 'data', (data) ->
      data = data.toString().replace /\r\n?/g, '\n'
      if data?[-1..-1][0] is '\n' then data = data[0..-2]
      # log 'itach data', data
      parts = /^(.{15})(\d+)$/.exec data
      if parts and parts[1] is 'completeir,1:1,' and +parts[2] is idCount
        endSendIR null, data
        return
      log 'itach data error: ' + idCount + ', ' + data

    itach.on 'end', (err) ->
      # log 'itach end', err
      if err then endSendIR 'end err: ' + err.message;  return
      endSendIR()
    return

  writeToItach irData, (err) ->
    if err
      endSendIR 'writeToItach err: ' + err.message
      return

sendingCmd = no

exports.sendCmd = (cmd, cb) ->
  # log 'sending cmd: ' + cmd
  if sendingCmd then cb?(); return
  sendingCmd = yes
  sendIR irDataByCmd[cmd], (err, data) ->
    sendingCmd = no
    if err or data[0..2] is 'ERR'
      log 'sendIR err: ' + (err?.message ? data); cb? err; return
    # log 'received cmd: ' + cmd
    cb?()

# i = 0
# do one = ->
#   if not (code = ['pwrOn', 12000, 'hdmi1','hdmi2','hdmi3','hdmi4','pwrOff'][i++])
#     log 'finished'
#     process.exit()
#   if typeof code isnt 'string'
#     setTimeout one, code
#     return
#   log 'sending ' + code
#   exports.sendCmd code, (err) ->
#     if err then log 'sendCmd err: ', err.message; process.exit()
#     else setTimeout one, 2000
#
