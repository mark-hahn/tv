
util = require 'util'
log  = require('debug') 'tv:pldb'
uql  = require 'unqlite'
plex = require './plex'

db = new uql.Database 'db/plex2.db'
tvShowsKey = plexDbContinuousSync = null

exports.init = (cb) ->
  db.open (err) ->
    if err then log 'db open err:', err; cb err; return
  plex.getSectionKeys (err, keys) ->
    if err or not (tvShowsKey = keys.tvShowsKey)
      log 'getSectionKeys err: ' + err.message, keys; cb err; return
    plexDbContinuousSync()
    cb()

setTimeout ->
  db.close -> process.exit 0
, 10000
    
put = (value, cb) ->
  log 'put: --->', value.id, value.type, value.title
  db.store value.id, JSON.stringify(value), (err) ->
    if err then log 'db put err:', err; cb err; return
    cb()

get = (key, cb) ->
  db.fetch key, (err, __, value) ->
    if err?.toString()[-2..] is '-6' then log 'get: <---', key, 'not found'
    else 
      dbg = JSON.parse value
      log 'get: <---', key, (err ? ''), (dbg?.id ? ''), (dbg?.type ? ''), (dbg?.title ? '')
    if err 
      if err.toString()[-2..] is '-6'
        cb()
        return
      log 'db get err:', err
      cb err
      return
    cb null, JSON.parse value
    
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
        
      get show.id, (err, dbShow) ->
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
            episodeIdList.push episode.id
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
            
          episodeIdList.push episode.id
      
          get episode.id, (err, dbEpisode) ->
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
          
        
      

    