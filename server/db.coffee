
log = require('./utils') '  db'

fs   = require 'fs'
util = require 'util'
db   = require('nano') 'http://localhost:5984/tv'
cfg  = require('parent-config') 'apps-config.json'

{CHROOT, USER, HOME_IP, AT_HOME, SERVER_IP, SERVER_HOST, DEBUG, LOCATION, OFF_SITE} = process.env

inDev = (process.cwd().indexOf('/dev/') > -1)
tvShowsCache = (if SERVER_HOST is 'localhost' then 'tvShowsCache' else '/tmp/tvShowsCache')

tvShowsKey = null

tagList = [
  'Foreign', 'Comedy', 'Drama', 'MarkOnly', 'MarkFavs', 'LindaOnly'     
  'LindaFavs', 'Kids', 'OnTheFence', 'Archive', 'Deleted', 'New', 'LessThan3', 'Watched'
]      

exports.getShowList = (cb) ->
  cb null, 
    try 
      JSON.parse fs.readFileSync tvShowsCache, 'utf8'
    catch e
      []

exports.setField = (id, key, val, cb) ->
  if typeof val isnt 'boolean' and val isnt '' and not isNaN val then val = +val;
  exports.get id, (err, doc) ->
    if err then log 'setField get err: ' + err.message, {id, key, val}; cb? err; return
    if not doc then log 'setField doc missing: ', {id, key, val}; cb? 'doc missing'; return
    obj = doc
    for attr in key.split '.'
      if typeof obj[attr] is 'object' then obj = obj[attr] 
      else obj[attr] = val
    log 'setField', {id, key, val, obj}
    exports.put doc, (err) ->
      if err then log 'setField put err: ' + err.message, {key, val}; cb? err; return
      # exports.syncPlexDB()
      cb? null, doc

exports.view = (viewName, opts, cb) ->
  db.view 'all', viewName, opts, cb
    
exports.get = (key, cb) ->
  db.get key, (err, doc) ->
    if err 
      if err?.error is 'not_found' 
        cb()
        return
      log 'db get err:', err
      cb err
      return
    cb null, doc
    
syncErr = (err, msg) ->
  if err
    log 'ABORT: syncPlexDB ' + msg + ' err:', err
    process.exit 1
    
exports.put = (doc, cb) ->
  db.get doc._id, (err, readVal) ->
    if readVal?._rev then doc._rev = readVal._rev
    db.insert doc, (err) ->
      if err?.statusCode is 409
        exports.put doc, cb
        return
      if err then log 'db put err:', err; cb err; return
      cb()

exports.delete = (doc, cb) ->
  db.destroy doc._id, doc._rev, (err) ->
    if err?.statusCode is 409 or not doc._rev
      db.get id, (err, doc) ->
        if err
          log 'db.delete get err:', err
          cb err
          return
        exports.delete doc, cb
      return
    if err then log 'delete err', err.message
    cb?()

insideSync = no
syncTO = null
exports.syncPlexDB = ->
  # if syncTO then clearTimeout syncTO; syncTO = null
  # if insideSync then syncTO = setTimeout exports.syncPlexDB, 1000; return
  # insideSync = yes
  # 
  # plex.getShowList tvShowsKey, (err, shows) ->
  #   syncErr err, 'getShowList'
  #   
  #   if not shows or shows.length is 0 then insideSync = no; return
  #   
  #   showIdx = 0
  #   do oneShow = ->
  #     if not (show = shows[showIdx++])
  #       fs.writeFileSync tvShowsCache, JSON.stringify shows
  #       # log 'syncPlexDB written'
  #       insideSync = no
  #       syncTO ?= setTimeout exports.syncPlexDB, 600e3
  #       return
  #       
  #     exports.get show.id, (err, dbShow) ->
  #       syncErr err, 'get show'
  #       
  #       # log util.inspect show, depth:null
  #       # process.exit 0
  #       
  #       if dbShow then show.tags = dbShow.tags
  #       for tag in tagList then show.tags[tag] ?= no
  #       
  #       episodeIdx = 0
  #       numWatched = 0
  #       do oneEpisode = ->
  #         
  #         if not (episode = show.episodes[episodeIdx++])
  #           totalEpisodes = episodeIdx-1
  #           show.tags.New       = (numWatched is 0)
  #           show.tags.Watched   = (numWatched is totalEpisodes)
  #           show.tags.LessThan3 = (totalEpisodes < 3)
  #           
  #           # count = 0
  #           # for i of show.tags
  #           #   count++
  #           # log '', count, numWatched, show.tags.New, show.tags.Watched, show.title
  #           # if show.title.indexOf('strong') > -1 then process.exit 0
  #           
  #           if not dbShow or show.tags.New       isnt dbShow.tags.New     or
  #                            show.tags.Watched   isnt dbShow.tags.Watched or
  #                            show.tags.LessThan3 isnt dbShow.tags.LessThan3
  #             dbShow = 
  #               _id:        show.id
  #               tags:       show.tags
  #               type: 'show'
  #             exports.put dbShow, (err) ->
  #               syncErr err, 'put new show'
  #               oneShow()
  #             return
  #           oneShow()
  #           return
  # 
  #         exports.get episode.id, (err, dbEpisode) ->
  #           syncErr err, 'get episode'
  #             
  #           watched = 
  #             if dbEpisode
  #               (episode.viewCount > dbEpisode.viewCount) or dbEpisode.watched
  #             else 
  #               (episode.viewCount > 0)
  #           if watched then numWatched++
  #           episode.watched = watched
  # 
  #           if dbEpisode and episode.viewCount is dbEpisode.viewCount and
  #                                      watched is dbEpisode.watched
  #             oneEpisode()
  #             return
  #           
  #           dbEpisode =
  #             _id:       episode.id
  #             viewCount: episode.viewCount
  #             watched:   watched
  #             type:     'episode'
  #             
  #           exports.put dbEpisode, (err) -> 
  #             syncErr err, 'put episode'
  #             oneEpisode()
