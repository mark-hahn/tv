
fs     = require 'fs-plus'
ffmpeg = require 'fluent-ffmpeg'
log    = require('debug') 'tv:vdproc'
mkdirp = require 'mkdirp'
rmrf   = require 'rmrf'

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
  topProcPath = '/mnt/media/videos-processing'
  allProcPaths = fs.listTreeSync topProcPath
  for procPath in allProcPaths when not fs.isDirectorySync procPath
    fs.removeSync procPath.replace '/videos-processing/', '/videos-small/'
    fs.removeSync procPath
  rmrf topProcPath
  mkdirp.sync topProcPath

  allPaths = fs.listTreeSync '/mnt/media/videos'
  for path, idx in allPaths 
    # if /\/\d+-/.test path
    #   fs.removeSync path
    #   log 'deleted file', path
    #   continue
    if fs.isDirectorySync path
      dir = path.replace '/videos/', '/videos-small/'
      log 'creating directory', dir
      fs.makeTreeSync dir
      continue
    shrunkPath = (path.replace '/videos/', '/videos-small/') + '.mp4'
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
