
fs   = require 'fs-plus'
rmrf = require 'rmrf'
exec = require('child_process').exec
pathUtil = require 'path'

usb_ip     = '37.48.119.77'
usb_user   = 'xobtlu'

videosPath = (if (p = process.argv[2]) then p else '/mnt/media/videos/')
# console.log videosPath
# return

cmd = "ssh #{usb_user}@#{usb_ip} ls /home4/#{usb_user}/videos"
exec cmd, (err, stdout, stderr) ->
  if err then throw err
  usbPaths = stdout.split '\n'
  # console.log fs.listTreeSync videosPath
  
  onDirectory = (path) -> 
    {root, dir, base: dirName, ext, name} = pathUtil.parse path
    # console.log 'dirName', dirName
      
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
      ###
        /home/user/dir/file.txt ==>
          root : "/",
          dir : "/home/user/dir",
          base : "file.txt",
          ext : ".txt",
          name : "file"
      ###
      {root, dir, base, ext, name} = pathUtil.parse file
      log 'process.exit 0, file', {root, dir, base, ext, name}
      process.exit 0
      
      if fs.isDirectorySync file
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
  
  
  
  
  
