
log = require('./utils') ' vlc'

exec = require 'child_process'
net  = require 'net'

vlcip_wlk = '192.168.1.102'
vlcip_tv  = '192.168.1.104'
vlc_port  = 1250

socket = playPos = file = showId = episodeId = null
gettingPlayPos = no

initSocket = ->
  # log 'vlc initSocket'
  socket = net.connect vlc_port, vlcip_tv
  socket.on 'data', (data) -> 
    res = data.toString()
    # log 'socket recvd:', res.replace /\n/g, ' '
    if gettingPlayPos
      matches = /^\s*(\d+)\s*$/.exec res
      if matches then playPos = +matches[1]
  socket.on 'error', (err) ->
    log 'socket error', err
    cb?()
  socket.on 'end', (data) -> 
    if data then log 'socket end:', data.toString().replace /\n/g, ' '

vlcCmd = (command) ->
  if not socket 
    # log 'vlcCmd closed socket', command
    # console.trace()
    return
  try
    # log 'socket write:', command
    socket.write command + '\n'
    # log 'socket written:', command
  catch e
    log 'retrying', 'command', e.message
    closeSocket()
    initSocket()
    setTimeout (-> vlcCmd command), 1000

nosub = ->
  vlcCmd 'strack 0'
    
closeSocket = ->
  if not socket 
    # log 'closeSocket closed socket'
    # console.trace()
    return
  log 'close socket'
  socket?.end()
  # log 'socket closed'
  socket = null
  
ssh = (commandLine, last) ->
  argArr = commandLine.split /\s+/
  argArr.unshift 'mark@' + vlcip_tv
  if last then argArr.push last
  try
    # log 'ssh'
    exec.execFile 'ssh', argArr, (err, stdout, stderr) ->
      # log 'ssh done'
      if err and stderr isnt 'vlc: no process found\n'
        log 'ssh callback err', {err, stdout, stderr}
  catch e
    log 'ssh err exception', e.message
    
vlcCmdLine = 'DISPLAY=:0 vlc -I rc -f --rc-host 0.0.0.0:' + vlc_port + ' --quiet'

muted  = delayAudio = no
volume = 120

killAllVlc = ->
  log 'killAllVlc'
  ssh 'killall vlc'
  
sshPlay = ->
  # log 'play (ssh)', 'mark@' + vlcip_tv, vlcCmdLine, '/home/mark/Videos/' + file
  ssh vlcCmdLine, '"/home/mark/Videos/' + file + '"'
  setTimeout ->
    initSocket()
    nosub()
    muted = no
    delayAudio = yes
  , 2000
  
exports.start = (showIdIn, episodeIdIn, fileIn) ->
  showId    = showIdIn
  episodeId = episodeIdIn
  file      = fileIn
  
  if socket
    # log 'play called with open socket'
    closeSocket()
    setTimeout ->
      initSocket()
      vlcCmd 'shutdown'
      setTimeout sshPlay, 2000
    , 1000
  else
    setTimeout sshPlay, 2000

exports.seek = (timeSecs) ->
  # log 'seek', timeSecs
  vlcCmd 'seek ' + Math.floor timeSecs

exports.playRate = (playRate) ->
  # log 'rate', playRate
  vlcCmd 'rate ' + playRate
  
exports.playPause = ->
  # log 'pause'
  vlcCmd 'pause'

exports.stop = ->
  # log 'stop'
  file = null
  vlcCmd 'shutdown'
  closeSocket()
  setTimeout killAllVlc, 300

exports.status = (cb) ->
  if not socket
    cb null, notShowing: yes
    return
  if gettingPlayPos then cb null, busy: yes; return
  gettingPlayPos = yes
  playPos = null
  loopCount = 0
  vlcCmd 'get_time'
  do check = ->
    if playPos?
      gettingPlayPos = no
      # log 'check have playpos:', playPos, delayAudio
      if playPos > 0 and delayAudio
        delayAudio = no
        vlcCmd 'volume ' + volume
        # log 'delayAudio volume muted:', volume, muted
      # log 'check cb', {showId, episodeId, file, playPos, volume, muted}
      cb null, {showId, episodeId, file, playPos, volume, muted}
    else if ++loopCount > 40
      gettingPlayPos = no
      log 'get_time call timed out'
      cb 'timeout'
    else
      setTimeout check, 50

volinc = (ticks) ->
  volume += ticks
  if ticks < 0 and muted then return
  vlcCmd 'volume ' + volume
  # log 'volinc volume, muted', ticks, volume, muted
  muted = no

exports.volup   = -> volinc +10
exports.voldown = -> volinc -10
  
exports.toggleMute = ->
  # log 'toggleMute'
  if not muted
    muted = yes
    vlcCmd 'volume 0'
    # log 'toggleMute volume muted:', volume, muted
  else
    muted = no
    vlcCmd 'volume ' + volume
    # log 'toggleMute volume muted:', volume, muted

###
    Unit Tests
###

if process.argv[2] is 'pos'
  initSocket()
  setInterval ->
    exports.getPlayPos (err, showId, episodeId, file, playPos) ->
      # log 'getPlayPos result', err?.message, 
          #  showId, episodeId, file, playPos
  , 1000
  
if process.argv[2] is 'pause'
  initSocket()
  exports.pause()

if process.argv[2] is 'test'
  # initSocket()
  # exports.play 'Brooklyn.Nine-Nine.S02E13.720p.HDTV.x264-KILLERS.mkv', ->
  secs = Math.floor Math.random() * 900 + 150
  exports.seek secs
  setTimeout ->
    exports.pause()
    setTimeout ->
      exports.play()
    , 3e3
  , 3e3

###
    VLC CTL COMMANDS
    
| add XYZ  . . . . . . . . . . . . . . . . . . . . add XYZ to playlist
| enqueue XYZ  . . . . . . . . . . . . . . . . . queue XYZ to playlist
| playlist . . . . . . . . . . . . .  show items currently in playlist
| search [string]  . .  search for items in playlist (or reset search)
| delete [X] . . . . . . . . . . . . . . . . delete item X in playlist
| move [X][Y]  . . . . . . . . . . . . move item X in playlist after Y
| sort key . . . . . . . . . . . . . . . . . . . . . sort the playlist
| sd [sd]  . . . . . . . . . . . . . show services discovery or toggle
| play . . . . . . . . . . . . . . . . . . . . . . . . . . play stream
| stop . . . . . . . . . . . . . . . . . . . . . . . . . . stop stream
| next . . . . . . . . . . . . . . . . . . . . . .  next playlist item
| prev . . . . . . . . . . . . . . . . . . . .  previous playlist item
| goto, gotoitem . . . . . . . . . . . . . . . . .  goto item at index
| repeat [on|off]  . . . . . . . . . . . . . .  toggle playlist repeat
| loop [on|off]  . . . . . . . . . . . . . . . .  toggle playlist loop
| random [on|off]  . . . . . . . . . . . . . .  toggle playlist random
| clear  . . . . . . . . . . . . . . . . . . . . .  clear the playlist
| status . . . . . . . . . . . . . . . . . . . current playlist status
| title [X]  . . . . . . . . . . . . . . set/get title in current item
| title_n  . . . . . . . . . . . . . . . .  next title in current item
| title_p  . . . . . . . . . . . . . .  previous title in current item
| chapter [X]  . . . . . . . . . . . . set/get chapter in current item
| chapter_n  . . . . . . . . . . . . . .  next chapter in current item
| chapter_p  . . . . . . . . . . . .  previous chapter in current item
| 
| seek X . . . . . . . . . . . seek in seconds, for instance `seek 12'
| pause  . . . . . . . . . . . . . . . . . . . . . . . .  toggle pause
| fastforward  . . . . . . . . . . . . . . . . . . set to maximum rate
| rewind . . . . . . . . . . . . . . . . . . . . . set to minimum rate
| faster . . . . . . . . . . . . . . . . . .  faster playing of stream
| slower . . . . . . . . . . . . . . . . . .  slower playing of stream
| normal . . . . . . . . . . . . . . . . . .  normal playing of stream
| rate [playback rate] . . . . . . . . . .  set playback rate to value
| frame  . . . . . . . . . . . . . . . . . . . . . play frame by frame
| fullscreen, f, F [on|off]  . . . . . . . . . . . . toggle fullscreen
| info . . . . . . . . . . . . .  information about the current stream
| stats  . . . . . . . . . . . . . . . .  show statistical information
| get_time . . . . . . . . .  seconds elapsed since stream's beginning
| is_playing . . . . . . . . . . . .  1 if a stream plays, 0 otherwise
| get_title  . . . . . . . . . . . . . the title of the current stream
| get_length . . . . . . . . . . . .  the length of the current stream
| 
| volume [X] . . . . . . . . . . . . . . . . . .  set/get audio volume
| volup [X]  . . . . . . . . . . . . . . .  raise audio volume X steps
| voldown [X]  . . . . . . . . . . . . . .  lower audio volume X steps
| achan [X]  . . . . . . . . . . . .  set/get stereo audio output mode
| atrack [X] . . . . . . . . . . . . . . . . . . . set/get audio track
| vtrack [X] . . . . . . . . . . . . . . . . . . . set/get video track
| vratio [X] . . . . . . . . . . . . . . .  set/get video aspect ratio
| vcrop, crop [X]  . . . . . . . . . . . . . . . .  set/get video crop
| vzoom, zoom [X]  . . . . . . . . . . . . . . . .  set/get video zoom
| vdeinterlace [X] . . . . . . . . . . . . . set/get video deinterlace
| vdeinterlace_mode [X]  . . . . . . .  set/get video deinterlace mode
| snapshot . . . . . . . . . . . . . . . . . . . . take video snapshot
| strack [X] . . . . . . . . . . . . . . . . .  set/get subtitle track
| hotkey, key [hotkey name]  . . . . . . . . . . simulate hotkey press
| 
| vlm  . . . . . . . . . . . . . . . . . . . . . . . . .  load the VLM
| set [var [value]]  . . . . . . . . . . . . . . . . . set/get env var
| save_env . . . . . . . . . . . .  save env vars (for future clients)
| alias [cmd]  . . . . . . . . . . . . . . . . set/get command aliases
| description  . . . . . . . . . . . . . . . . .  describe this module
| license  . . . . . . . . . . . . . . . . print VLC's license message
| help, ? [pattern]  . . . . . . . . . . . . . . . . .  a help message
| longhelp [pattern] . . . . . . . . . . . . . . a longer help message
| lock . . . . . . . . . . . . . . . . . . . .  lock the telnet prompt
| logout . . . . . . . . . . . . . .  exit (if in a socket connection)
| quit . . . . . . . .  quit VLC (or logout if in a socket connection)
| shutdown . . . . . . . . . . . . . . . . . . . . . . .  shutdown VLC
###
