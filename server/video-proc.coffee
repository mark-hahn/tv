
log = (args...) -> console.log.call console, 
                     moment().format().replace('T', ' ')[0..18],
                     (['video-proc:'].concat args)...

fs     = require 'fs-plus'
ffmpeg = require 'fluent-ffmpeg'
mkdirp = require 'mkdirp'
rmrf   = require 'rmrf'
moment = require 'moment'

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
      .on 'end', cb
      .save dst
  catch e
    log 'shrinkOneVideo exception', src, e.message
    cb()
    
do onePass = ->
  if newCount then log 'finished processing', newCount, 'videos'
  allPaths = fs.listTreeSync '/mnt/media/videos'
  for path, idx in allPaths when not /\/\./.test path
    shrunkPath = (path.replace '/videos/', '/videos-small/') + '.mp4'
    if not fs.existsSync shrunkPath then newCount++
  if newCount is 0 then setTimeout onePass, 60e3

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
    if not (path = allPaths.shift()) then onePass(); return
    
    if not /\/\./.test path
      
      if fs.isDirectorySync path
        dir = path.replace '/videos/', '/videos-small/'
        fs.makeTreeSync dir
        oneShrink()
        return
        
      shrunkPath = (path.replace '/videos/', '/videos-small/') + '.mp4'
      if not fs.existsSync shrunkPath
        procPath =  shrunkPath.replace '/videos-small/', '/videos-processing/'
        fs.writeFileSync procPath, ''
        shrinkOneVideo path, shrunkPath, ->
          fs.removeSync procPath
          oneShrink()
        return
        
      oneShrink()
      return
      
    oneShrink()
