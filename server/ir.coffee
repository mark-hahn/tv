###
  src/ir.coffee
###

log = require('./utils') '  IR'
request = require('request')

codeByCmd =
  power:  0
  pwrOff: 1
  pwrOn:  2
  volUp:  3
  volDn:  4
  mute:   5
  hdmi1:  6
  hdmi2:  7
  hdmi3:  8
  hdmi4:  9

exports.sendCmd = (cmd, cb) ->
  log 'sending cmd: ' + cmd
  request "http://192.168.1.242/?code=" + codeByCmd[cmd], (error, response, body) ->
    if (!error && response.statusCode == 200) then log 'send ok: ', cmd
    else log 'send failed: ', cmd
    cb?()
