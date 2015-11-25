
log = (args...) -> 
  console.log.call console, 'guessit:', args...

fs   = require 'fs-plus'
exec = require('child_process').spawnSync
plex = require './plex'
tvdb = require './tvdb'
Fuzz = require 'fuzzyset.js'

uuid = ->
  uuidStr = Date.now() + (Math.random() * 1e13).toFixed 0
  while uuidStr.length < 28 then uuidStr += (Math.floor Math.random() * 10)
  uuidStr

dbgExit = (args...) ->
  log args..., '\n\ndbgExit' 
  process.exit 0

deleteNullProps = (obj) ->
  for k, v of obj when \
      not v? or v is 'undefined' or v is 'null' or v is NaN
    delete obj[k]

guessit = (filePath) ->
  fileName = filePath.replace '/mnt/media/videos/', ''
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

exports.guess = (filePath) ->
  guessData = guessit filePath
  if not guessData.series
    fs.appendFileSync 'files/skipped-files-no-series.txt', 'mv "' + filePath + '" "' + filePath + '"\n'
    return null
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
  {series, guessData}

exports.getMatchInitData = (cb) ->
  plex.getSectionKeys (err, res) ->
    if err then throw err
    {tvShowsKey} = res
    log 'getting plex showlist'
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
      cb null, fuzz, showsByShowTitle

dbShows        = {}  # todo, load these from db
printedMatches = {}

exports.matchPlexToFile = (fuzz, showsByShowTitle, filePath) ->
  if not fs.isFileSync filePath then return
  if /\..{6}$/.test filePath
    fs.appendFileSync 'files/skipped-files-partial.txt', 'rm -rf "' + filePath + '"\n'
    return
  file = filePath.replace '/mnt/media/videos/', ''
  
  dbAddShow = (guessData, show, cb) ->
    key = show?.title ? guessData.series
    if not (doc = dbShows[key])
      doc = _id: uuid(), type: 'show', guessTitle: guessData.series
      if show 
        doc.plexTitle = show.title
        doc.plexId    = show.id
        Object.assign doc, show
      delete doc.id
      delete doc.title
      delete doc.episodes
      deleteNullProps doc   
      dbShows[key] = doc
      # log 'dbAddShow', doc
    cb? null, doc._id
    
  # todo, check for duplicates in db
  dbAddEpisode = (doc, cb) ->
    doc._id  = uuid()
    doc.type = 'episode'
    delete doc.id
    delete doc.episodes
    delete doc.series
    delete doc.releaseGroup
    delete doc.mimetype
    delete doc.videoCodec
    delete doc.container
    delete doc.episodeNumber
    deleteNullProps doc   
    # log 'dbAddEpisode', doc
    cb? null, doc._id

  if not (guess = exports.guess filePath) then return
  {series, guessData} = guess
  
  fuzzRes   = fuzz.get series
  score     = fuzzRes?[0]?[0]
  showTitle = fuzzRes?[0]?[1]
  show      = showsByShowTitle[showTitle]
  
  if typeof score isnt 'number' 
    fs.appendFileSync 'files/skipped-files-no-fuzz', 'rm -rf "' + filePath + '"\n'
    return

  printMatch = (msg) ->
    key = guessData.series + ' ~ ' + show.title
    if score < 1 and key not of printedMatches
      printedMatches[key] = true
      scoreStr = score.toFixed 2
      seriesStr = guessData.series[0...40]
      while seriesStr.length < 40 then seriesStr = seriesStr + ' '
      titleStr = show.title[0...40]
      while titleStr.length < 40 then titleStr = titleStr + ' '
      fs.appendFileSync 'files/match-' + msg, scoreStr + ' ' + seriesStr + ' ' + titleStr + '\n'

  addGuessOnlyEpisode = (showId) ->
    doc = Object.assign {}, 
                        guessData, 
                        showId:   showId
                        season:  +guessData.season
                        episode: +guessData.episodeNumber
                        file:     file
    dbAddEpisode doc, (err, episodeId) ->
      fs.appendFileSync 'files/guess-only-episodes', showId + ' ' + episodeId + ' ' + filePath + '\n'
    
  if score >= 0.65
    printMatch 'high-score'
    
    dbAddShow guessData, show, (err, showId) =>
      for episode in show.episodes ? []
        showSeasonEpisode = episode.episodeNumber.split '-'
        plexSeason        = +showSeasonEpisode[0]
        plexEpisode       = +showSeasonEpisode[1]
        guessSeason       = +guessData.season
        guessEpisode      = +guessData.episodeNumber
        if plexSeason  is guessSeason and
           plexEpisode is guessEpisode
          dbAddEpisode Object.assign {}, 
                                     guessData, episode,
                                     showId:  showId
                                     plexId:  episode.id
                                     season:  guessSeason
                                     episode: guessEpisode
                                     file: file
          return
      addGuessOnlyEpisode showId
      
  else
    printMatch 'low-score'
    
    dbAddShow guessData, null, (err, showId) -> 
      addGuessOnlyEpisode showId


## initial db load -- merges plex and filenames -- writes db shows and episodes

exports.getMatchInitData (err, fuzz, showsByShowTitle) ->
  log 'getting video file name list'
  for filePath in fs.listTreeSync '/mnt/media/videos'
    exports.matchPlexToFile fuzz, showsByShowTitle, filePath
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
  