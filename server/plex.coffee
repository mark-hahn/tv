###
  src/plex.coffee
###

util    = require 'util'
request = require 'request'
log     = require('debug') 'tv:plex'

# plexServerIp    = '192.168.1.11'
plexServerIp    = '192.168.1.103'
plexServerPort  = 32400

getPlexData = (path, eleType, cb) ->
  opts =
    url: "http://#{plexServerIp}:#{plexServerPort}#{path}"
    headers: Accept: 'application/json'
  request opts, (err, resp, body) ->
    # log {err, resp, body}
    if err or resp.statusCode isnt 200
      log 'getPlexData req error:', opts, resp.statusCode, util.inspect err, depth:null
      cb? err
      return
    libResponse = JSON.parse body
    data = []
    for child in libResponse._children when not eleType or child._elementType is eleType
      data.push child
    cb? null, data

exports.findRoku = (rokuName, cb) ->
  getPlexData '/clients', 'Server', (err, clients) ->
    if err then cb err; return
    for client in clients when client.name is rokuName
      cb null, client, plexServerIp, plexServerPort
      return
    log 'findRoku, roku client not found:', clients
    cb? message: 'roku client not found'
    
exports.getSectionKeys = (cb) ->
  getPlexData '/library/sections', 'Directory', (err, data) ->
    if err then cb err; return
    for dir in data
      switch dir.title
        when 'TV Shows' then tvShowsKey = dir.key
        when 'Movies'   then moviesKey  = dir.key
        else continue
    if not tvShowsKey or not moviesKey
      log 'getSectionKeys, key missing', data
      cb message: 'key missing'
      return
    cb null, {tvShowsKey, moviesKey}

exports.getShowList = (key, cb) ->
  
  getPlexData "/library/sections/#{key}/all", 'Directory', (err, shows) ->
    if err then cb err; return
    result = []
    
    do oneShow = ->
      if not (show = shows.shift())
        cb null, result
        return

      {title, summary, thumb} = show
      result.push resShow = {title, summary, thumb}
      
      getPlexData show.key, 'Directory', (err, seasons) ->
        if err then cb err; return
        resShow.episodes = []
        
        do oneSeason = ->
          if not (season = seasons.shift())
            oneShow()
            return
          if season.type isnt 'season' then oneSeason(); return
          seasonNumber = /\d*$/.exec(season.title)[0]
          getPlexData season.key, 'Video', (err, episodes) ->
            if err then cb err; return
            for episode in episodes when episode.type is 'episode'
              {index, title, summary, thumb} = episode
              # log episode
              # process.exit 0
              resShow.episodes.push {seasonNumber, index, title, summary, thumb}
            oneSeason()
            
# exports.getStatus = (cb) ->
#   getPlexData '/status/sessions', 'Video', cb
#   
# 
