
fs   = require 'fs-plus'
rmrf = require 'rmrf'
exec = require('child_process').exec

usbIp = '37.48.119.77'
user  = 'xobtlu'
videosPath = '/mnt/media/videos/'

exec "ssh #{user}@#{usbIp} ls /home4/xobtlu/videos", (err, stdout, stderr) ->
  if err then throw err
  usbPaths = stdout.split '\n'
  # console.log fs.listTreeSync videosPath
  
  onDirectory = (path) -> 
    pathParts = path.split '/'
    
    dirName = pathParts[4]
      
    if dirName in usbPaths
      console.log 'skipping path in usb videos:', dirName
      return

    contents = fs.listSync videosPath + dirName
    
    if contents.length is 0
      console.log 'deleting empty dir:', dirName
      fs.removeSync path
      return
    
    # console.log '-----', path
      
    if dirName is 'part-videos'
      # console.log '\nskipping part-videos directory', contents
      return
      
    for file in contents
      if pathParts.length > 5
        file = videosPath + pathParts[5]
        console.log 'doing nested folder:', pathParts[4...], 
        
      fileName =  file.split('/')[5]

      outerFile = videosPath + fileName
      if fs.isFileSync outerFile
        sizeInnerFile = fs.getSizeSync file
        sizeOuterFile = fs.getSizeSync outerFile
        if sizeInnerFile <= sizeOuterFile
          console.log 'deleting existing inner file:', fileName
          fs.removeSync file
        else
          console.log 'deleting existing outer file:', fileName
          fs.removeSync outerFile
        continue
        
      console.log 'moving file/dir out:', fileName
      fs.moveSync file, outerFile
    
  
  fs.traverseTreeSync videosPath, (->), onDirectory
  
  
  
  
  
