
util   = require 'util'
moment = require 'moment'

logWithTime = (args...) -> 
  time = moment().format 'MM-DD HH:mm:ss'
  console.log time, args...

module.exports = (modName) ->
  (args...) -> 
    try
      if args[0][0..1] is 'i '
        args = [args[0][2...], util.inspect args[1], depth:null]
    logWithTime modName.toLowerCase() + ' ', args...
