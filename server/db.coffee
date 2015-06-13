
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
    
    log 'put: --->', value._id, value.type, value.title
    db.insert value, (err) ->
      if err then log 'db put err:', err; cb err; return
      cb()
    

get = (key, cb) ->
  db.get key, (err, value) ->
    if err 
      if err?.error is 'not_found' 
        log 'get: <---', key, 'not found'
        cb()
        return
      log 'db get err:', err
      cb err
      return
    log 'get: <---', value._id, value.type, value.title
    cb null, value
    
exports.getShowList = ->
  plex.getShowList tvShowsKey, (err, shows) ->
    syncErr err, 'getShowList'
    cb null, shows

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
        if dbShow and dbShow.type isnt 'show'
          syncErr 'wrong show type "' + dbShow.type + '"'
          
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
            episode.watched = (+episode.viewCount > 0)
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
            if dbEpisode and dbEpisode.type isnt 'episode'
              syncErr 'wrong episode type "' + dbEpisode.type + '"'
              
            if not dbEpisode
              episode.watched = (+episode.viewCount > 0)
              put episode, (err) ->
                syncErr err, 'put new episode'
                oneEpisode()
              return
            
            if (+episode.viewCount ? 0) > (+dbEpisode.viewCount ? 0)
              episode.watched = yes
              put episode, (err) ->
                syncErr err, 'put old episode'
                oneEpisode()
            else
              oneEpisode()
          
        
      

    