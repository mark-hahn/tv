
# for insteon, see ...
#   /root/Dropbox/apps/hvac/src/commands.coffee
#   /root/Dropbox/apps/insteon-hub/src/main.coffee

http    = require 'http'
request = require 'request'
plex    = require './plex'
roku    = require './roku'

ajaxServerPort  = 32400

console.log 'starting tv ajax server'

srvr = http.createServer (req, res) ->
  res.end 'server says hello'

srvr.listen ajaxServerPort
