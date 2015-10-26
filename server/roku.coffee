###
  src/roku.coffee
###

util    = require 'util'
request = require 'request'
plex    = require './plex'
log     = require('debug') 'tv:roku'

plexServerIp    = null
plexServerPort  = null

rokuName        = 'Roku 3'
rokuIp          = null
rokuPort        = null
rokuMachineId   = null

roku = exports

playerCtrl = null #debug

exports.init = (cb) ->
  plex.findRoku rokuName, (err, client, plexServerIpIn, plexServerPortIn) ->
    if err 
      log 'roku.init failed', err
      cb? err
      return
    plexServerIp    = plexServerIpIn
    plexServerPort  = plexServerPortIn
    rokuIp          = client.host
    rokuPort        = client.port
    rokuMachineId   = client.machineIdentifier
    cb? null

playerCtrl = (cmd, params={}, cb) ->
  url = "http://#{rokuIp}:#{rokuPort}/player#{cmd}" +
          "?machineIdentifier=#{rokuMachineId}" +
          "&address=#{plexServerIp}" +
          "&port=#{plexServerPort}"
  for arg, val of params then url += '&' + arg + '=' + val
  opts ={url, headers: Accept: 'application/json'}
  log 'playerCtrl', opts
  request opts, (err, resp, body) ->
    if err or resp.statusCode isnt 200
      log 'playerCtrl error:', {opts, statusCode: resp?.statusCode, error: err?.message}
      cb? err
      return
    cb? null, body
          
exports.startVideo = (key, goToStart, cb) ->
  log 'startVideo', goToStart
  if goToStart then console.trace()
  offset = (if goToStart then 0 else 1)
  playerCtrl '/playback/playMedia', {key, offset}, (err, res) ->
    if err then cb? err; return
    cb? null, res
    
exports.playAction = (action, cb) ->
  # play and pause are both play/pause toggles
  # skipNext, skipPrevious (bumps playback speed, back to 1x pauses)
  # stepForward (defined but doesn't work)
  # stepBack (20 secs, adjustable in roku setup?)
  # stop (goes back in menu when repeated)
  playerCtrl "/playback/#{action}", null, (err, res) ->
    if err then cb? err; return
    cb? null, res

