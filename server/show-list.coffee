###
  src/show-list.coffee
###

log  = require('debug') 'tv:--list'
db   = require './db'
util = require 'util'

inGetShowList = no

showListCache = null

exports.getShowList = getList = (cb) ->
  if inGetShowList
    setTimeout (-> getList cb), 100
  inGetShowList = yes
    
  db.view 'showByTvdbTitle', (err, body) -> 
    if err then throw err
    shows = (row.value for row in body.rows)
     
    showSortStr = (show) ->
      title = show.tvdbTitle ? show.fileTitle ? show.title
      if not title
        log show.tvdbTitle, show.fileTitle, show.title
      title.replace /^The\s/i, ''
    
    result = []
    do oneShow = ->
      if not (show = shows.shift())
        result.sort (a,b) -> (if showSortStr(a) > showSortStr(b) then +1 else -1)
        cb null, result
        inGetShowList = no
        return
        
      watchedCount = availCount = 0

      {_id: id, tvdbTitle: title, summary, \
        started: year, length: duration, banners, tags} = show
      year = year?.split('-')[0]
      duration ?= 60
      thumb = null
      for key, val of banners when key.split('-')[0] is 'poster'
        thumb = val?[0]?.BannerPath
        break
      banner = banners['series-graphical']?[0]?.BannerPath

      result.push resShow = 
        {id, title, summary, thumb, year, duration, tags, banner}

      db.view 'episodeByShowSeasonEpisode',
        startkey: [id, null, null]
        endkey:   [id, {}, {}]
      , (err, body) -> 
        if err then throw err
        
        resShow.episodes = []
        skippingEpisodes = yes
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
          resShow.episodes.push {
            id: episodeId, showId: id, episodeNumber, title, summary, 
            thumb, viewCount:0, duration, watched, aired, filePaths, noFile}

        tags = resShow.tags
        if watchedCount is 0 then tags.New = yes
        else delete tags.New
        if availCount < 3 then tags.LessThan3 = yes
        else delete tags.LessThan3
        if watchedCount is availCount then tags.Watched = yes
        else delete tags.Watched
          
        oneShow()

exports.getStatus = (cb) ->
  cb null,
    id:        null
    videoFile: ''
    playPos:   0
    playState: 'stopped'

