
fs   = require 'fs'
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

exports.getShowList = (cb) ->
  cb null, 
    try 
      JSON.parse fs.readFileSync 'showListCache', 'utf8'
    catch e
      []

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
    
syncErr = (err, msg) ->
  if err
    log 'ABORT: plexDbContinuousSync ' + msg + ' err:', err
    process.exit 1
    
plexDbContinuousSync = ->
    
  plex.getShowList tvShowsKey, (err, shows) ->
    syncErr err, 'getShowList'
    
    showIdx = 0
    do oneShow = ->
      if not (show = shows[showIdx++])
        fs.writeFileSync 'showListCache', JSON.stringify shows
        setTimeout plexDbContinuousSync, 5*60*1000
        return
        
      get show.id, (err, dbShow) ->
        syncErr err, 'get show'
        
        if dbShow
          show.tags = dbShow.tags
        else
          dbShow = 
            _id:  show.id
            tags: show.tags
            type: 'show'
            
          db.insert dbShow, (err) ->
            syncErr err, 'put new show'
        
        episodeIdx = 0
        do oneEpisode = ->
          if not (episode = show.episodes[episodeIdx++])
            oneShow()
            return

          get episode.id, (err, dbEpisode) ->
            syncErr err, 'get episode'
              
            watched = 
              if dbEpisode
                (episode.viewCount > dbEpisode.viewCount) or dbEpisode.watched
              else 
                (episode.viewCount > 0)

            if episode.viewCount is dbEpisode?.viewCount and
                         watched is dbEpisode?.watched
              oneEpisode()
              return
              
            episode.watched = watched
            
            dbEpisode =
              _id:       episode.id
              viewCount: episode.viewCount
              watched:   watched
              type:     'episode'
              
            put dbEpisode, (err) -> 
              syncErr err, 'put episode'
              oneEpisode()
