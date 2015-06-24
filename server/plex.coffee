###
  src/plex.coffee
###

util    = require 'util'
request = require 'request'
log     = require('debug') 'tv:plex'
moment  = require 'moment'

{CHROOT, USER, HOME_IP, AT_HOME, SERVER_IP, SERVER_HOST, DEBUG, LOCATION, OFF_SITE} = process.env

plexServerIp   = SERVER_HOST
plexServerPort = (if OFF_SITE isnt 'false' then '17179' else '32400')
plexPfx  = "http://#{plexServerIp}:#{plexServerPort}"

getPlexData = (path, eleType, cb) ->
  opts =
    url: "#{plexPfx}#{path}"
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

      {key, title, summary, thumb, year, duration, leafCount, viewedLeafCount, type, banner} = show
        
      id = key.split('/')[3]
      tags = {}
      for child in show._children ? []
        if child._elementType is 'Genre' then tags[child.tag] = yes
      duration = +duration
      
      result.push resShow = {id, title, summary, thumb, year, duration, tags, type, banner}
                             
      getPlexData key, 'Directory', (err, seasons) ->
        if err then cb err; return
        resShow.episodes = []
        
        do oneSeason = ->
          if not (season = seasons.shift())
            oneShow()
            return
          if season.type isnt 'season' then oneSeason(); return
          
          getPlexData season.key, 'Video', (err, episodes) ->
            if err then cb err; return
            
            for episode in episodes when episode.type is 'episode'
              {index, title, summary, thumb, viewCount, key, duration,  \
               originallyAvailableAt, type} = episode

              id = key.split('/')[3]
              episodeNumber = season.index + '-' + index
              aired = moment(originallyAvailableAt).format('M/D/YY')
              duration = +duration
              viewCount ?= 0
              viewCount = +viewCount
              
              resShow.episodes.push {
                id, showId: resShow.id, episodeNumber, title, summary, \
                thumb, viewCount, key, duration, aired, type 
              }
            oneSeason()

exports.getStatus = (cb) ->
  getPlexData '/status/sessions', 'Video', (err, sessions) ->
    if err then cb err; return
    for session, sidx in (sessions ? []) when session?._elementType is 'Video'
      for player, pidx in session._children when player._elementType is 'Player'
        # log 'session:' + sidx, 'player:' + pidx, session.grandparentTitle, 
        #      session.viewOffset, player.title, player.state
        cb null,
          id:        session.key.split('/')[3]
          viewOffset: session.viewOffset
          state:      player.state
        return
    cb()

