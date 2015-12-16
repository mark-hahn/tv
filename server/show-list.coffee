###
  src/show-list.coffee
###

log = require('debug') 'tv:--plex'
db  = require './db'

inGetShowList = no

showListCache = null

exports.getShowList = getList = (cb) ->
  if inGetShowList
    setTimeout (-> getList cb), 100
  inGetShowList = yes
    
  db.view 'showByTvdbTitle', (err, body) -> 
    if err then throw err
    shows = (row.value for row in body.rows)
    
    result = []
    do oneShow = ->
      if not (show = shows.shift())
        cb null, result
        inGetShowList = no
        return

      {_id: id, tvdbTitle: title, summary, \
        started: year, length: duration, banners, tags: taglist} = show
      year = year?.split('-')[0]
      duration ?= 60
      thumb = null
      for key, val of banners when key.split('-')[0] is 'poster'
        thumb = val?[0]?.BannerPath
        break
      banner = banners['series-graphical']?[0]?.BannerPath

      tags = {}
      for tag in taglist then tags[tag] = yes

      result.push resShow = 
        {id, title, summary, thumb, year, duration, tags, banner}

      db.view 'episodeByShowSeasonEpisode',
        startkey: [id, null, null]
        endkey:   [id, {}, {}]
      , (err, body) -> 
        if err then throw err
        resShow.episodes = []
        for row in body.rows when (row.value.filePaths?.length ? 0) > 0
          {seasonNumber, episodeNumber, episodeTitle: title, summary, \
           thumb, _id: episodeId, length: episodeLen
           aired: originallyAvailableAt} = row.value
          episodeNumber = seasonNumber + '-' + episodeNumber
          resShow.episodes.push {
            id: episodeId, showId: id, episodeNumber, title
            summary, thumb, viewCount: 0, key, episodeLen  
            aired: aired ? null, filePath: row.value.filePaths[0]    
          }
        oneShow()

exports.getStatus = (cb) ->
  cb null,
    id:        null
    videoFile: ''
    playPos:   0
    playState: 'stopped'

