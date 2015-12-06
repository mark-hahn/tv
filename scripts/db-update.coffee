
log = (args...) -> 
  console.log.call console, 'dbupdt:', args...

fs   = require 'fs-plus'
exec = require('child_process').spawnSync
Fuzz = require 'fuzzyset.js'
plex = require '../server/plex'
tvdb = require '../server/tvdb'
db   = require '../server/db'

uuid = ->
  uuidStr = Date.now() + (Math.random() * 1e13).toFixed 0
  while uuidStr.length < 28 then uuidStr += (Math.floor Math.random() * 10)
  uuidStr

dbgExit = (args...) ->
  log args..., '\n\ndbgExit' 
  throw 'debug exit'

deleteNullProps = (obj) ->
  for k, v of obj when \
      not v? or v is 'undefined' or v is 'null' or v is NaN
    delete obj[k]

getShowByTitle = (isShow, title, cb) ->
  if not title then setImmediate cb; return
  if isShow then view = 'showByPlexTitle'
  else           view = 'showByFileTitle'
  db.view view, {key: title}, (err, body) ->
    if err?.status is 404 then cb(); return
    else if err then throw err
    if body.rows.length is 0 then cb(); return
    cb null, body.rows[0].value

dbAddShow = (fileData, show, cb) ->
  doc = type: 'show' 
  if show 
    doc.plexTitle = show.title
    doc.plexId    = show.id
    Object.assign doc, show
  if fileData
    doc.fileTitle = fileData.series
  getShowByTitle yes, doc.plexTitle, (err, plexShow) ->
    getShowByTitle no, doc.fileTitle, (err, fileShow) ->
      newDoc = null
      if not plexShow and not fileShow
        doc._id = uuid()
        newDoc = doc
      else if plexShow and not fileShow
        newDoc = Object.assign {}, plexShow, doc
      else if fileShow and not plexShow
        newDoc = Object.assign {}, fileShow, doc
      else
        newDoc = Object.assign {}, fileShow, plexShow, doc
      delete newDoc.id
      delete newDoc.title
      delete newDoc.episodes
      delete newDoc.matched
      deleteNullProps newDoc
      db.put newDoc, (err) -> 
        if err then throw err
        if not plexShow or not fileShow
          cb null, newDoc._id
          return
        db.view 'episodeByShowId', {key: fileShow._id}, (err, body) ->
          if err then throw err
          do oneRow = ->
            if not (row = body.rows.shift())
              db.delete fileShow, (err) ->
                if err then throw err
                cb null, newDoc._id
              return 
            episodeDoc = row.value
            episodeDoc.showId = newDoc._id
            db.put episodeDoc, (err) ->
              if err then throw err
              oneRow() 
  
dbAddEpisode = (doc, cb) ->
  db.view 'episodeByShowSeasonEpisode', \
          {key: [doc.showId, doc.season, doc.episode]}, (err, body) ->
    if err?.status is 404
      doc._id = uuid()
    else if err then throw err
    else if body.rows.length is 0
      doc._id = uuid()
    else doc = Object.assign {}, body.rows[0].value, doc
    doc.type = 'episode'
    delete doc.id
    delete doc.episodes
    delete doc.series
    delete doc.cleanSeries
    delete doc.releaseGroup
    delete doc.mimetype
    delete doc.videoCodec
    delete doc.container
    delete doc.episodeNumber
    delete doc.matched
    delete doc.audioChannels
    deleteNullProps doc   
    db.put doc, (err) ->
      if err then throw err
      cb null, doc._id

addFileOnlyEpisode = (filePath, fileData, showId, cb) ->
  file = filePath.replace '/mnt/media/videos/', ''
  doc = Object.assign {}, 
                      fileData, 
                      showId:   showId
                      season:  +fileData.season
                      episode: +fileData.episodeNumber
                      file:     file
  dbAddEpisode doc, (err, episodeId) ->
    fs.appendFileSync 'files/file-only-episodes', 'mv "' + filePath + '" "' + filePath + '"\n'
    cb()
    
addPlexOnlyEpisode = (episode, showId, cb) ->
  showSeasonEpisode = episode.episodeNumber.split '-'
  plexSeason        = +showSeasonEpisode[0]
  plexEpisode       = +showSeasonEpisode[1]
  doc = Object.assign {},
                      episode, 
                      showId:   showId
                      season:   plexSeason
                      episode:  plexEpisode
  dbAddEpisode doc, (err, episodeId) ->
    fs.appendFileSync 'files/plex-only-episodes', showId + ' ' + episodeId + '\n'
    cb()
    
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

exports.getFileData = (filePath) ->
  fileData = guessit filePath
  if not fileData.series
    fs.appendFileSync 'files/skipped-files-no-series.txt', 'mv "' + filePath + '" "' + filePath + '"\n'
    return null
  cleanSeries = fileData.series.replace /\s*\(\d+\)\s*$|\s*\[[^\]]+\]\s*$/g, ''
  cleanSeries = cleanSeries.replace /^(the\s+|aaf-|daa-)/i, ''
  cleanSeries = switch cleanSeries.toLowerCase()
    when 'buffy'                           then 'Buffy the Vampire Slayer'
    when 'mst3k'                           then 'Mystery Science Theater 3000'
    when 'mst3k (cu)'                      then 'Mystery Science Theater 3000'
    when 'cicgc'                           then 'Comedians In Cars Getting Coffee'
    when 'amazon pilot season'             then 'Amazon Pilot Season Fall 2015 Good Girls'
    when 'bob servant'                     then 'Bob Servant Independent'
    when 'miranda christmas special'       then 'Miranda'
    when 'sex and drugs and rock and roll' then 'Sex, Chips & Rock n\' Roll'
    when 'sex drugs and rock and roll'     then 'Sex, Chips & Rock n\' Roll'
    when 'tmawl'                           then 'That Mitchell And Webb Look'
    else cleanSeries
  if (isNaN(fileData.season) or isNaN(fileData.episodeNumber)) and
     (matches = /(\d+)x(\d+)/i.exec filePath)
      fileData.season        = +matches[1]
      fileData.episodeNumber = +matches[2]
  fileData.cleanSeries = cleanSeries
  fileData

exports.getInitData = (cb) ->
  plex.getSectionKeys (err, res) ->
    if err then throw err
    {tvShowsKey} = res
    log 'getting plex showlist'
    plex.getShowList tvShowsKey, (err, showList) ->
      if err then throw err
      showTitles       = [] 
      showsByShowTitle = {}
      for show in showList
        showTitle = show.title.replace /\s*\(\d+\)\s*$|\s*\[[^\]]+\]\s*$/g, ''
        showTitle = showTitle.replace /^the\s+/i, ''
        showTitles.push showTitle
        showsByShowTitle[showTitle] = show
      fuzz = new Fuzz showTitles
      cb null, fuzz, showList, showsByShowTitle

printedMatches = {}

exports.writeDbForFile = (fuzz, showsByShowTitle, filePath, cb) ->
  if not fs.isFileSync filePath then setImmediate cb; return
  
  if /(\.[^\.]{6}|\.filepart)$/i.test filePath
    fs.appendFileSync 'files/skipped-files-partial.txt', 'rm -rf "' + filePath + '"\n'
    setImmediate cb
    return
    
  file = filePath.replace '/mnt/media/videos/', ''
  
  if not (fileData = exports.getFileData filePath) then setImmediate cb; return
  
  fuzzRes   = fuzz.get fileData.cleanSeries
  score     = fuzzRes?[0]?[0]
  showTitle = fuzzRes?[0]?[1]
  show      = showsByShowTitle[showTitle]
  
  if fileData.cleanSeries.indexOf('mst3k') > -1
    log 'fuzzRes mst3k', {fileData, fuzzRes}
  
  if typeof score isnt 'number' 
    fs.appendFileSync 'files/skipped-files-no-fuzz', 'rm -rf "' + filePath + '"\n'
    setImmediate cb
    return

  printMatch = (msg) ->
    key = fileData.series + ' ~ ' + show.title
    if score < 1 and key not of printedMatches
      printedMatches[key] = true
      scoreStr = score.toFixed 2
      seriesStr = fileData.series[0...40]
      while seriesStr.length < 40 then seriesStr = seriesStr + ' '
      titleStr = show.title[0...40]
      while titleStr.length < 40 then titleStr = titleStr + ' '
      fs.appendFileSync 'files/match-' + msg, scoreStr + ' ' + seriesStr + ' ' + titleStr + '\n'

  if score >= 0.65
    printMatch 'high-score'
    
    dbAddShow fileData, show, (err, showId) ->
      show.matched = yes
      for episode in show.episodes
        showSeasonEpisode = episode.episodeNumber.split '-'
        plexSeason        = +showSeasonEpisode[0]
        plexEpisode       = +showSeasonEpisode[1]
        fileSeason        = +fileData.season
        fileEpisode       = +fileData.episodeNumber
        if plexSeason  is fileSeason and
           plexEpisode is fileEpisode
          doc =
            showId:  showId
            plexId:  episode.id
            season:  fileSeason
            episode: fileEpisode
            file:    file
          dbAddEpisode Object.assign({}, fileData, episode, doc), cb
          return
      addFileOnlyEpisode filePath, fileData, showId, cb
      
  else
    printMatch 'low-score'
    
    dbAddShow fileData, null, (err, showId) -> 
      addFileOnlyEpisode filePath, fileData, showId, cb

exports.getInitData (err, fuzz, showList, showsByShowTitle) ->
  if err then throw err
  log 'getting file list'
  files = fs.listTreeSync '/mnt/media/videos'
  
  oneFile = ->
    if not (filePath = files.shift())
      log 'getting plex shows with no file'
      oneShow()
      return
    exports.writeDbForFile fuzz, showsByShowTitle, filePath, oneFile
    
  showIdx = 0
  oneShow = ->
    if not (show = showList[showIdx++])
      log 'done' 
      return
    if not show.matched
      dbAddShow null, show, (err, showId) ->
        episodeIdx = 0
        do oneEpisode = ->
          if not (episode = show.episodes[episodeIdx++])
            oneShow()
            return
          addPlexOnlyEpisode episode, showId, oneEpisode
    else
      setImmediate oneShow 
       
  oneFile()
    
###
function(doc) {  // showByPlexTitle
  if (doc.type == 'show' && doc.plexTitle)
    emit(doc.plexTitle, doc);
}
function(doc) { // showByFileTitle
  if (doc.type == 'show' && !doc.plexTitle)
      emit(doc.fileTitle, doc);
}
function(doc) { // episodeByShowId
  if (doc.type == 'episode')
    emit(doc.showId, doc);
}
function(doc) { // episodeByShowSeasonEpisode
  if (doc.type == 'episode')
    emit([doc.showId, doc.season, doc.episode], doc);
}
###

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
  