
fs = require 'fs-plus'
util = require 'util'

process.exit 0  # do not accidentally run

dir = '/mnt/media/videos/Buffy.S02.NTSC.DVD.DD2.0.x264hi10-LiGHTSPEED/'
#     buffy.e30.killed.by.death.ntsc.dvd.dd2.0.x264hi10-lightspeed.mkv
for file in fs.listSync dir
  parts = /^(.*\/buffy\.)e(\d+)(\..*)$/.exec file
  newName = parts[1] + 's2e' + (+parts[2] - 12) + parts[3]
  console.log newName
  fs.renameSync file, newName
  