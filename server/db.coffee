
fs   = require 'fs'
util = require 'util'
log  = require('debug') 'tv:pldb'
plex = require './plex'
db   = require('nano') 'http://localhost:5984/tv'
cfg  = require('parent-config') 'apps-config.json'

{CHROOT, USER, HOME_IP, AT_HOME, SERVER_IP, SERVER_HOST, DEBUG, LOCATION, OFF_SITE} = process.env

inDev = (process.cwd().indexOf('/dev/') > -1)
tvShowsCache = (if SERVER_HOST is 'localhost' then 'tvShowsCache' else '/tmp/tvShowsCache')

tvShowsKey = null

tagList = [
  'Foreign', 'Comedy', 'Drama', 'Crime', 'MarkOnly', 'LindaOnly'     
  'Favorite', 'OnTheFence', 'Archive', 'Deleted', 'New', 'Watched'
]      

exports.init = (cb) ->
  plex.getSectionKeys (err, keys) ->
    if err or not (tvShowsKey = keys.tvShowsKey)
      log 'getSectionKeys err: ' + err.message, keys; cb err; return
    exports.syncPlexDB()
    cb()

exports.getShowList = (cb) ->
  cb null, 
    try 
      JSON.parse fs.readFileSync tvShowsCache, 'utf8'
    catch e
      []

exports.setField = (id, key, val, cb) ->
  # log 'setField', {id, key, val}
  if typeof val isnt 'boolean' and val isnt '' and
     not isNaN val then val = +val;
  get id, (err, doc) ->
    if err then log 'setField get err: ' + err.message, {id, key, val}; cb? err; return
    if not doc then log 'setField doc missing: ', {id, key, val}; cb? 'doc missing'; return
    obj = doc
    for attr in key.split '.'
      if typeof obj[attr] is 'object' then obj = obj[attr] 
      else obj[attr] = val
    # log 'doc', doc
    put doc, (err) ->
      if err then log 'setField put err: ' + err.message, {key, val}; cb? err; return
      exports.syncPlexDB()
      cb? null, doc
    
put = (value, cb) ->
  db.get value._id, (err, readVal) ->
    if readVal?._rev then value._rev = readVal._rev
    # log 'put: ---->', value._id, value.type
    db.insert value, (err) ->
      if err?.statusCode is 409
        put value, cb
        return
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
    log 'ABORT: syncPlexDB ' + msg + ' err:', err
    process.exit 1
    
insideSync = no
syncTO = null
exports.syncPlexDB = ->
  if syncTO then clearTimeout syncTO; syncTO = null
  if insideSync then syncTO = setTimeout exports.syncPlexDB, 1000; return
  insideSync = yes
  
  plex.getShowList tvShowsKey, (err, shows) ->
    syncErr err, 'getShowList'
    
    if not shows or shows.length is 0 then insideSync = no; return
    
    showIdx = 0
    do oneShow = ->
      if not (show = shows[showIdx++])
        fs.writeFileSync tvShowsCache, JSON.stringify shows
        log 'syncPlexDB written'
        insideSync = no
        syncTO ?= setTimeout exports.syncPlexDB, 600e3
        return
        
      get show.id, (err, dbShow) ->
        syncErr err, 'get show'
        
        # log util.inspect show, depth:null
        # process.exit 0
        
        if dbShow then show.tags = dbShow.tags
        for tag in tagList then show.tags[tag] ?= no
        
        episodeIdx = 0
        numWatched = 0
        do oneEpisode = ->
          
          if not (episode = show.episodes[episodeIdx++])
            show.tags.New     = (numWatched is 0)
            show.tags.Watched = (numWatched is episodeIdx-1)
            
            # count = 0
            # for i of show.tags
            #   count++
            # log '', count, numWatched, show.tags.New, show.tags.Watched, show.title
            # if show.title.indexOf('strong') > -1 then process.exit 0
            
            if not dbShow or show.tags.New isnt dbShow.tags.New or
                         show.tags.Watched isnt dbShow.tags.Watched
              dbShow = 
                _id:        show.id
                tags:       show.tags
                type: 'show'
              put dbShow, (err) ->
                syncErr err, 'put new show'
                oneShow()
              return
            oneShow()
            return

          get episode.id, (err, dbEpisode) ->
            syncErr err, 'get episode'
              
            watched = 
              if dbEpisode
                (episode.viewCount > dbEpisode.viewCount) or dbEpisode.watched
              else 
                (episode.viewCount > 0)
            if watched then numWatched++
            episode.watched = watched

            if dbEpisode and episode.viewCount is dbEpisode.viewCount and
                                       watched is dbEpisode.watched
              oneEpisode()
              return
            
            dbEpisode =
              _id:       episode.id
              viewCount: episode.viewCount
              watched:   watched
              type:     'episode'
              
            put dbEpisode, (err) -> 
              syncErr err, 'put episode'
              oneEpisode()
