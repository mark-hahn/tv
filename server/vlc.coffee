
log = (args...) -> 
  console.log.apply console, ['vlc:'].concat args
  
exec = require('child_process').execFile
net  = require 'net'

vlcip = '192.168.1.104'

vlcCmd = (command, cb) ->
  try
    socket = net.connect 1250, vlcip
    socket.on 'data', (data) -> log 'socket recvd:', data.toString().replace /\n/g, ' '
    socket.on 'error', (err) -> 
      log 'socket error', err
      cb?()
    socket.on 'end', -> cb?()
    socket.write command + '\n', ->
      log 'socket sent:', command
      socket.end()
  catch e
    log 'vlcCmd err', command, e.message

ssh = (user, commandLine, cb) ->
  argArr = commandLine.split /\s+/
  argArr.unshift user + '@' + vlcip
  try
    exec 'ssh', argArr, (err) ->
      if err and err.message.indexOf('fuse: mountpoint is not empty') is -1
        log 'ssh err', err.message
      cb?()
  catch e
    cb?()

exports.play = (file, cb) ->
  exports.stop ->
    ssh 'root', 'sshfs hahnca.com:/mnt/media /mnt/media 
                 -o reconnect,cache=no,direct_io,max_readahead=0x10000000', ->
      ssh 'root', 'bindfs /mnt/media/videos /home/mark/Videos', ->
        setTimeout ->
          vlcCmd 'f on' 
          cb?()
        , 10e3
        ssh 'mark', 'DISPLAY=:0 vlc -I rc --rc-host 0.0.0.0:1250 /home/mark/Videos/' + file

exports.stop = (cb) ->
  ssh 'root', 'killall vlc', cb

exports.play 'About.a.Boy.S02E07.720p.HDTV.X264-DIMENSION.mkv', ->
  log 'pausing'
  vlcCmd 'pause'


###

ssh-tvm DISPLAY=:0 vlc -I rc --rc-host 0.0.0.0:1250 /home/mark/About.a.Boy.S02E11.720p.HDTV.X264-DIMENSION.mkv
xdotool click 1
echo "f on"   | nc 192.168.1.104 1250
echo pause    | nc 192.168.1.104 1250
echo shutdown | nc 192.168.1.104 1250

VLC media player 2.1.6 Rincewind
Command Line Interface initialized. Type `help' for help.
> +----[ CLI commands ]
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
+----[ end of help ]
> Shutting down.

/home/mark/.config/vlc/vlcrc -- line 1661
 # Audio output device (string)
   alsa-audio-device=hdmi

###
