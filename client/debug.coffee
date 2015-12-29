
moment = require 'moment'

logWithTime = (args...) -> 
  time = moment().format 'HH:mm:ss'
  console.log time, args...

module.exports = (modName) ->
  
  (args...) -> logWithTime modName.toLowerCase() + ' ', args...
