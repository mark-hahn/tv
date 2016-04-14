###
  src/show-list.coffee
###

log = require('./utils') 'list'
db   = require './db'
util = require 'util'

exports.getShowList = getList = (cb) ->
  db.view 'showByTitle', (err, body) -> 
    if err then throw err
    result = []
    for row in body.rows
      show  = row.value
      show.title = row.key
      {_id: id, title, summary, started: year, \
       length: duration, banners, tags} = show
      year = year?.split('-')[0]
      duration ?= 60
      thumb = null
      for key, val of banners when key.split('-')[0] is 'poster'
        thumb = val?[0]?.BannerPath
        break
      banner = banners['series-graphical']?[0]?.BannerPath
      result.push resShow = 
        {id, title, summary, thumb, year, duration, tags, banner, episodes: []}
    showSortStr = (show) ->
      title = show.tvdbTitle ? show.fileTitle ? show.title
      if not title
        log show.tvdbTitle, show.fileTitle, show.title
      title.replace /^The\s/i, ''
    result.sort (a,b) -> (if showSortStr(a) > showSortStr(b) then +1 else -1)
    cb null, result

exports.getEpisodeList = (showId, cb) ->
  skippingEpisodes = yes
  episodes = []
  watchedCount = availCount = 0
  db.view 'episodeByShowId', key: showId, (err, body) -> 
    if err then cb? err; return
    for row in body.rows
      episode = row.value
      if skippingEpisodes    and 
         not episode.watched and 
         not episode.filePaths?[0]?
           continue
      skippingEpisodes = no
      availCount++
      {seasonNumber, episodeNumber, episodeTitle: title, summary, \
       thumb, _id: episodeId, duration, aired, watched, filePaths} = episode
      noFile = (not filePaths or filePaths.length is 0)
      watched ?= no
      if watched then watchedCount++
      episodeNumber = seasonNumber + '-' + episodeNumber
      episodes.push {
        id: episodeId, episodeNumber, title, summary, thumb, viewCount:0, 
        duration, watched, aired, filePaths, noFile, showId}
    
    if watchedCount is availCount    
      db.get showId, (err, doc) ->
        if err then throw err
        tags = doc.tags
        if not tags.Watched
          tags.Watched = yes
          db.put doc, ->
            cb? null, {watchedCount, availCount, episodes}
          return
        cb? null, {watchedCount, availCount, episodes}
      return
    cb? null, {watchedCount, availCount, episodes}
