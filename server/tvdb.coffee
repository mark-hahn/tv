
log = (args...) -> 
  console.log.apply console, ['tvdb:'].concat args

TVDB = require 'node-tvdb/compat'
tvdb = new TVDB '2C92771D87CA8718"'

exports.getSeriesByName = (name, cb) ->
  tvdb.getSeriesByName name, (err, res) ->
    if err then throw err
    log {err, res}
    cb null, res


###  TVDB
  acct id F6DF9C666C2A3259
  user id 444819
  api key 2C92771D87CA8718
 
  getSeriesByName - Get basic series information by name
  getSeriesById - Get basic series information by id
  getSeriesAllById - Get full/all series information by id
  getEpisodesById - Get all episodes by series id
  getEpisodeById - Get episode by episode id
  getActors - Get series actors by series id
  getEpisodeByAirDate- Get series episode by air date
  getBanners - Get series banners by series id
  getUpdates - Get series and episode updates since a given unix timestamp
  utils.parsePipeList - Parse pipe list string to javascript array
###
