
util = require 'util'
tvdb = require '../server/tvdb'

tvdb.getShowByName process.argv[2], (err, res) ->
  console.log util.inspect res, depth:null

