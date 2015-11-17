
log = (args...) -> console.log.call console, 
                     moment().format().replace('T', ' ')[0..18],
                     (['video-proc:'].concat args)...

fs     = require 'fs-plus'
ffmpeg = require 'fluent-ffmpeg'
mkdirp = require 'mkdirp'
rmrf   = require 'rmrf'
moment = require 'moment'
mv     = require 'mv'

newCount = 0
count = 0

shrinkOneVideo = (src, dst, cb) ->
  log 'shrinking', ++count, 'of', newCount, src.replace('/mnt/media/videos/', '')[0..70]
  try
    ffmpeg(timeout: 20*60e3, niceness: 20)
      .input src
      .videoCodec 'libx264'
      .videoBitrate 96
      .size '640x?'
      .audioCodec 'libmp3lame'
      .withAudioChannels 1
      .withAudioBitrate 16
      .addOption '-sn'
      .renice 20
      .on 'error', (err, stdout, stderr) -> 
          log 'ffmpeg err', {src, err: err.message, stdout, stderr}
      .on 'end', cb
      .save dst
  catch e
    log 'shrinkOneVideo exception', src, e.message
    cb()
    
haveList = no
newCount = 0

do onePass = ->
  log 'onePass'
  if newCount then log 'finished processing', newCount, 'videos'
  newCount = 0
  allPaths = fs.listTreeSync '/mnt/media/videos'
  for path, idx in allPaths
    if /\/\.[^\/]+\.\w{6}$/i.test path
      log 'moving to partials:', path
      mv path, path.replace('/videos/', '/videos-partials/'), onePass
      return
    if fs.isDirectorySync path
      log 'directory:', path
      dir = path.replace '/videos/', '/videos-small/'
      fs.makeTreeSync dir
      continue
      return
    shrunkPath = path.replace('/videos/', '/videos-small/') + '.mp4'
    if not fs.existsSync shrunkPath 
      newCount++
      if not haveList then log 'counting:', newCount, path
  if newCount is 0 then setTimeout onePass, 60e3
  
  haveList = yes

  topProcPath = '/mnt/media/videos-processing'
  allProcPaths = fs.listTreeSync topProcPath
  for procPath in allProcPaths when not fs.isDirectorySync procPath
    fs.removeSync procPath.replace '/videos-processing/', '/videos-small/'
    fs.removeSync procPath
  rmrf topProcPath
  mkdirp.sync topProcPath
  
  console.log '\nstarted processing', newCount, 'videos\n'
  
  count = 0
  do oneShrink = ->
    if not (path = allPaths.shift()) then setImmediate onePass; return
    
    shrunkPath = (path.replace '/videos/', '/videos-small/') + '.mp4'
    if not fs.existsSync shrunkPath
      procPath =  shrunkPath.replace '/videos-small/', '/videos-processing/'
      fs.writeFileSync procPath, ''
      shrinkOneVideo path, shrunkPath, ->
        fs.removeSync procPath
        setImmediate oneShrink
      return
      
    setImmediate oneShrink
