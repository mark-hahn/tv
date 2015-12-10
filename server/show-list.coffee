###
  src/show-list.coffee
###

log = require('debug') 'tv:--plex'
db  = require './db'

inGetShowList = no

exports.getShowList = getList = (cb) ->
  if inGetShowList
    setTimeout (-> getList cb), 100
  inGetShowList = yes
    
  db.view 'showByFileTitle', (err, body) -> 
    if err then throw err
    show = (row.value for row in body.rows)
    
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
        thumb = val?.BannerPath[0]
        break
      tags = {}
      for tag in taglist then tags[tag] = yes
        
      result.push resShow = 
        {id, title, summary, thumb, year, duration, tags, banner}
                            
      resShow.episodes = []
      db.view 'episodeByShowSeasonEpisode',
        keystart: [id, null, null]
        keyend:   [id, {}, {}]
      , (err, body) -> 
        if err then throw err
        for row in body.rows when (row.value.filePaths?.length ? 0) > 0
          {seasonNumber, episodeNumber, episodeTitle: title, summary, \
           thumb, _id: key, length: episodeLen, 
           aired: originallyAvailableAt} = episode
          episodeNumber = seasonNumber + '-' + episodeNumber
          resShow.episodes.push {
            id, showId: resShow.id, episodeNumber, title, summary, \
            thumb, viewCount: 0, key, episodeLen, aired 
          }
          oneShow()

exports.getStatus = (cb) ->
  cb null,
    id:        null
    videoFile: ''
    playPos:   0
    playState: 'stopped'

