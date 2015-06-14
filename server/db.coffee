
util = require 'util'
log  = require('debug') 'tv:pldb'
plex = require './plex'
db   = require('nano') 'http://localhost:5984/tv'

tvShowsKey = plexDbContinuousSync = null

exports.init = (cb) ->
  plex.getSectionKeys (err, keys) ->
    if err or not (tvShowsKey = keys.tvShowsKey)
      log 'getSectionKeys err: ' + err.message, keys; cb err; return
    plexDbContinuousSync()
    cb()

put = (value, cb) ->
  db.get value._id, (err, readVal) ->
    if readVal?._rev then value._rev = readVal._rev
    # log 'put: ---->', value._id, value.type, value.title
    db.insert value, (err) ->
      if err then log 'db put err:', err; cb err; return
      cb()

get = (key, cb) ->
  db.get key, (err, value) ->
    if err 
      if err?.error is 'not_found' 
        # log 'get: <----', key, 'not found'
        cb()
        return
      log 'db get err:', err
      cb err
      return
    # log 'get: <----', value._id, value.type, value.title
    cb null, value
    
getShows = (cb) ->
  db.view 'all', 'shows', (err, shows) ->
    if err then log 'getShows err:', err; cb err; return
    cb null, (row.value for row in shows.rows)

getEpisodesForShow = (showId, cb) ->
  params = 
    startkey: [showId, null, null]
    endkey:   [showId,   {},   {}]
  db.view 'all', 'episodes', params, (err, episodes) ->
    if err then log 'getEpisodesForShow err:', err; cb err; return
    cb null, (row.value for row in episodes.rows)

exports.getShowList = (cb) ->
  getShows (err, shows) ->
    if err then log 'getShowList err:', err; cb err; return
    
    resShows = []
    do oneShow = ->
      if not (show = shows.shift()) then cb null, resShows; return

      getEpisodesForShow show._id, (err, episodes) -> 
        if err then log 'getShowList getEpisodesForShow err:', err; cb err; return
        show.episodes = episodes
        resShows.push show
        oneShow()
  
syncErr = (err, msg) ->
  if err
    log 'ABORT: plexDbContinuousSync ' + msg + ' err:', err
    process.exit 1
    
plexDbContinuousSync = ->
  plex.getShowList tvShowsKey, (err, shows) ->
    syncErr err, 'getShowList'
    
    do oneShow = ->
      if not (show = shows.shift())
        setTimeout plexDbContinuousSync, 10*60*1000
        return
        
      get show._id, (err, dbShow) ->
        syncErr err, 'get show'
          
        if not dbShow
          episodeIdList = []
          do oneEpisode = ->
            if not (episode = show.episodes.shift())
              show.episodes = episodeIdList
              put show, (err) ->
                syncErr err, 'put new show'
                oneShow()
              return
            episodeIdList.push episode._id
            episode.watched = (+(episode.viewCount ? 0) > 0)
            put episode, (err) ->
              syncErr err, 'put new show episode'
              oneEpisode()
          return
        
        episodeIdList = []
        do oneEpisode = ->
          if not (episode = show.episodes.shift())
            show.episodes = episodeIdList
            show.tags = dbShow.tags
            put show, (err) ->
              syncErr err, 'put old show'
              oneShow()
            return
            
          episodeIdList.push episode._id
      
          get episode._id, (err, dbEpisode) ->
            syncErr err, 'get episode'
              
            if not dbEpisode
              episode.watched = (+(episode.viewCount ? 0) > 0)
              put episode, (err) ->
                syncErr err, 'put new episode'
                oneEpisode()
              return
            
            episode.watched = 
              (+(episode.viewCount ? 0)) > (+(dbEpisode.viewCount ? 0)) or
               dbEpisode.watched
              
            put episode, (err) ->
              syncErr err, 'put old episode'
              oneEpisode()

