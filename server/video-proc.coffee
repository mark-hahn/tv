
fs     = require 'fs-plus'
ffmpeg = require 'fluent-ffmpeg'
log    = require('debug') 'tv:vdproc'

shrinkOneVideo = (src, dst, cb) ->
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
    
do oneShrink = ->
  allProcPaths = fs.listTreeSync '/mnt/media/videos-processing'
  for procPath in allProcPaths
    fs.removeSync procPath.replace '/videos-processing/', '/videos-small/'
    fs.removeSync procPath
  allPaths = fs.listTreeSync '/mnt/media/videos'
  for path, idx in allPaths 
    if fs.isDirectorySync path
      log 'skipping directory', path
      continue
    shrunkPath = (path.replace '/videos/', '/videos-small/') + '.mkv'
    if not fs.existsSync shrunkPath
      log '===>', idx+1, 'of', allPaths.length, '-->' + path
      procPath =  shrunkPath.replace '/videos-small/', '/videos-processing/'
      fs.writeFileSync procPath, ''
      shrinkOneVideo path, shrunkPath, ->
        fs.removeSync procPath
        oneShrink()
      return
  log 'all files shrunk, waiting 5 mins'
  setTimeout oneShrink, 300e3
