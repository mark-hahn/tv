
log = (args...) -> 
  console.log.apply console, ['guessit:'].concat args

fs   = require 'fs-plus'
exec = require('child_process').spawnSync
plex = require './plex'
tvdb = require './tvdb'
Fuzz = require 'fuzzyset.js'
uuid = require 'node-uuid'

exports.guessit = (fileName) ->
  {stdout, stderr, status, error, output} = 
           exec 'guessit', [fileName], timeout: 60e3
  stdout = stdout?.toString()
  stderr = stderr?.toString()
  output = output?.toString()
  resArr = output.split '\n'
  res = {}
  for field in resArr
    if (match = /^\s*[\d\.\[\]]+\s"([^"]+)":\s"?([^"]+)"?,/.exec field)
      # log {match}
      [__, key, val] = match
      res[key] = val
  res

dbAddShow = (guessData, show, cb) ->
  doc = Object.assign show, 
                      _id:        uuid.v4()
                      type:      'show'
                      plexTitle:  show.title
                      guessTitle: guessData.series
  delete doc.episodes
  delete doc.id
  delete doc.title
  log 'dbAddShow', doc
  cb? null, doc._id
  
dbAddEpisode = (doc, cb) ->
  doc.type = 'episode'
  log 'dbAddEpisode', doc
  cb? null, doc._id

plex.getSectionKeys (err, res) ->
  if err then throw err
  {tvShowsKey} = res
  
  log 'getting showlist'
  plex.getShowList tvShowsKey, (err, showList) ->
    if err then throw err
    
    showTitles       = [] 
    showsByShowTitle = {}
    for show in showList
      showTitle = show.title.replace /\s*\([^\)]+\)\s*$|\s*\[[^\]]+\]\s*$/g, ''
      showTitle = showTitle.replace /^the\s+/i, ''
      showTitles.push showTitle
      showsByShowTitle[showTitle] = show
    fuzz = new Fuzz showTitles
    
    printedMatches = {}
    log 'getting video file name list'
    for filePath in fs.listTreeSync '/mnt/media/videos'
      file = filePath.replace '/mnt/media/videos/', ''
      
      if fs.isFileSync filePath
        guessData = exports.guessit filePath
        
        if not guessData.series
           fs.appendFileSync 'files/skipped-files-no-series.txt', 'mv "' + filePath + '" "' + filePath + '"\n'
          continue
          
        if guessData.extension?.length is 6
          fs.appendFileSync 'files/skipped-files-partial.txt', 'rm -rf "' + filePath + '"\n'
          continue
          
        series = guessData.series.replace /\s*\([^\)]+\)\s*$|\s*\[[^\]]+\]\s*$/g, ''
        series = series.replace /^the\s+/i, ''
        series = switch series.toLowerCase()
          when 'buffy'                           then 'Buffy the Vampire Slayer'
          when 'mst3k'                           then 'Mystery Science Theatre 3000'
          when 'cicgc'                           then 'Comedians In Cars Getting Coffee'
          when 'amazon pilot season'             then 'Amazon Pilot Season Fall 2015 Good Girls'
          when 'bob servant'                     then 'Bob Servant Independent'
          when 'miranda christmas special'       then 'Miranda'
          when 'sex and drugs and rock and roll' then 'Sex, Chips & Rock n\' Roll'
          when 'sex drugs and rock and roll'     then 'Sex, Chips & Rock n\' Roll'
          else series
            
        if (isNaN(guessData.season) or isNaN(guessData.episodeNumber)) and
           (matches = /(\d+)x(\d+)/i.exec filePath)
            guessData.season        = +matches[1]
            guessData.episodeNumber = +matches[2]
        
        fuzzRes   = fuzz.get series
        score     = fuzzRes?[0]?[0]
        showTitle = fuzzRes?[0]?[1]
        show      = showsByShowTitle[showTitle]
        
        if typeof score isnt 'number' 
          fs.appendFileSync 'files/skipped-files-no-fuzz', 'rm -rf "' + filePath + '"\n'
          continue
        
        printMatch = (msg) ->
          key = guessData.series + '~' + show.title
          if key not of printedMatches
            printedMatches[key] = true
            if score < 1
              scoreStr = score.toFixed 2
              seriesStr = guessData.series[0...40]
              while seriesStr.length < 40 then seriesStr = seriesStr + ' '
              titleStr = show.title[0...40]
              while titleStr.length < 40 then titleStr = titleStr + ' '
              fs.appendFileSync 'files/skipped-files-' + msg, score + ' ' + seriesStr + ' ' + titleStr + '\n'
          
        doc = null
        
        if score >= 0.65
          printMatch 'high-score'
          dbAddShow guessData, show, (showId) =>
            for episode in show.episodes
              showSeasonEpisode = episode.episodeNumber.split '-'
              plexSeason        = +showSeasonEpisode[0]
              plexEpisode       = +showSeasonEpisode[1]
              guessSeason       = +guessData.season
              guessEpisode      = +guessData.episodeNumber
              if plexSeason  is guessSeason and
                 plexEpisode is guessEpisode
                doc = Object.assign guessData, episode,
                                    _id:            uuid.v4()
                                    showId:         showId
                                    plexShowTitle:  show.title
                                    guessShowTitle: guessData.series
                                    season:         guessSeason
                                    episode:        guessEpisode
                                    filePath:       file
                doc.type = 'episode'
                delete doc.episodeNumber
                delete doc.episodes
                delete doc.series
                delete doc.id
                delete doc.showId
                delete doc.releaseGroup
                delete doc.mimetype
                delete doc.videoCodec
                delete doc.container
                delete doc.episodeNumber
                break
                
            if not doc 
              fs.appendFileSync 'files/guess-only-episodes', filePath
                                 
              # todo -- save show for doc, not just episode
              
              doc = Object.assign guessData, 
                                  _id:            uuid.v4()
                                  guessShowTitle: guessData.series
                                  season:        +guessData.season
                                  episode:       +guessData.episodeNumber
                                  file:           file
              delete doc.series
              delete doc.episodeNumber
              delete doc.releaseGroup
              delete doc.mimetype
              delete doc.videoCodec
              delete doc.container
              
            for k, v of doc when \
                not v or v is 'undefined' or v is 'null' or v is NaN or v is ''
              delete doc[k]
          
            dbAddEpisode doc
        else
          printMatch 'low-score'
          
        log 'process.exit 0'
        process.exit 0
        
    log 'done'    
    
###
  GUESSIT
    [ 'mimetype', 'video/mp4' ],
    [ 'episodeNumber', '9' ],
    [ 'container', 'mp4' ],
    [ 'format', 'HDTV' ],
    [ 'series', 'about a boy' ],
    [ 'releaseGroup', 'lol' ],
    [ 'season', '2' ]

  PLEX show in showlist
    id: '1043',
    title: 'Lachey\'s Bar',
    summary: 'Brothers Nick and Drew Lachey open a drinking establishment in their hometown of Cincinnati.',
    thumb: '/library/metadata/1043/thumb/1448259105',
    year: 2015,
    duration: 1800000,
    tags: { Reality: true },
    type: 'show',
    banner: '/library/metadata/1043/banner/1448259105',
    episodes: [
     { id: '22',
       showId: '4',
       episodeNumber: '2-20',
       title: 'About a Love in the Air',
       summary: 'Marcus is reeling after his breakup with Shea, and Will and Fiona have opposing theories and methods of how to help him get over his first great heartbreak. It all comes to a head at the dance where Marcus very publically tries to win Shea back. And Liz, frustrated with Will\'s attachment to Fiona and Marcus, finally breaks up with Will. Will blames Fiona for everything. And after a huge argument Will and Fiona end up kissing.',
       thumb: '/library/metadata/22/thumb/1448257998',
       viewCount: 0,
       key: '/library/metadata/22',
       episodeLen: 1262.429,
       aired: '7/20/15',
       type: 'episode' 
     } 
    ]
  ###
  