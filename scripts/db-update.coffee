
log = (args...) -> 
  console.log.call console, 'dbupdt:', args...

fs   = require 'fs-plus'
exec = require('child_process').spawnSync
tvdb = require '../server/tvdb'
db   = require '../server/db'

videosPath = '/mnt/media/videos/'

uuid = ->
  uuidStr = Date.now() + (Math.random() * 1e13).toFixed 0
  while uuidStr.length < 28 then uuidStr += (Math.floor Math.random() * 10)
  uuidStr

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

exports.getFileData = (filePath) ->
  stats    = fs.statSync filePath
  fileSize = stats.size
  if not stats.isFile() then cb(); return
    
  fileData = guessit filePath
  if not fileData.series
    fs.appendFileSync 'files/file-no-series.txt', 'mv "' + filePath + '" "' + filePath + '"\n'
    return null
    
  filePath  = filePath.replace videosPath, ''
  fileTitle = fileData.series.replace /\s*\(\d+\)\s*$|\s*\[[^\]]+\]\s*$/g, ''
  fileTitle = fileTitle.replace /^(the\s+|aaf-|daa-)/i, ''
  fileTitle = switch fileTitle.toLowerCase()
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
    else fileTitle
  if (isNaN(fileData.season) or isNaN(fileData.episodeNumber)) and
     (matches = /(\d+)x(\d+)/i.exec filePath)
      seasonNumber  = +matches[1]
      episodeNumber = +matches[2]
  else
    seasonNumber  = +fileData.season
    episodeNumber = +fileData.episodeNumber
  {filePath, fileSize, fileTitle, seasonNumber, episodeNumber}

dbPutShow = (show, cb) ->
  show._id        = uuid()
  show.type       = 'show'
  delete show.episodes
  deleteNullProps show
  db.put show, cb
  
dbPutEpisode = (episode, cb) ->
  episode._id ?= uuid()
  episode.type = 'episode'
  deleteNullProps episode
  db.put episode, cb
  
seasonsChecked = {}
checkTvdbEpisodeList = (filePath, showId, episode, tvdbEpisodes, cb) ->
  episode.showId = showId
  
  key = showId + '-' + episode.seasonNumber
  if seasonsChecked[key] and episode.tvdbId
    dbPutEpisode episode, cb
    return
  seasonsChecked[key] = yes
  
  db.view 'episodeByShowSeasonEpisode',
          {startKey: [showId, episode.seasonNumber, null], \
           endKey:   [showId, episode.seasonNumber, {}]}
  , (err, body) -> 
    if err then throw err
    
    dbEpisodes = {}
    dbEpisodeNumbers = []
    for row in body.rows
      dbEpisode = row.value
      dbEpisodeNumber = dbEpisode.episodeNumber
      if dbEpisodeNumber is episode.episodeNumber
        episode = Object.assign {}, dbEpisode, episode
        
      dbEpisodeNumbers.push dbEpisodeNumber
      dbEpisodes[dbEpisodeNumber] = dbEpisode
      
    do oneTvdbEpisode = ->
      if not (tvdbEpisode = tvdbEpisodes.shift())
        if not episode.tvdbId
          fs.appendFileSync 'files/no-tvdb.txt', 
                            'mv "' + filePath + '" "' + filePath + '"\n'
        dbPutEpisode episode, cb
        return
        
      tvdbEpisodeNumber = tvdbEpisode.episodeNumber
      if tvdbEpisodeNumber is episode.episodeNumber
        Object.assign episode, tvdbEpisode
        oneTvdbEpisode()
        return
        
      if tvdbEpisode.episodeNumber in dbEpisodeNumbers
        oneTvdbEpisode()
        return
      
      tvdbEpisode.showId    = showId
      tvdbEpisode.filePaths = []
      dbPutEpisode tvdbEpisode, oneTvdbEpisode

buildEpisode = (buildArgs, tvdbEpisodes, cb) ->
  {newShow, fileTitle, filePath, show, episode} = buildArgs
  
  for tvdbEpisode in tvdbEpisodes ? []
    if tvdbEpisode.episodeNumber is episode.episodeNumber
      Object.assign episode, tvdbEpisode
      break
      
  if newShow      
    show.fileTitles = [fileTitle]
    dbPutShow show, ->
      checkTvdbEpisodeList filePath, show._id, episode, tvdbEpisodes, cb
  else
    if not tvdbEpisodes 
      tvdb.getEpisodesByTvdbShowId show.tvdbId, (err, tvdbEpisodes) ->
        if err then throw err
        checkTvdbEpisodeList filePath, show._id, episode, tvdbEpisodes, cb
    else
      checkTvdbEpisodeList filePath, show._id, episode, tvdbEpisodes, cb
  
checkEpisode = (newShow, show, fileData, cb) ->
  db.view 'episodeByShowSeasonEpisode',
          {key: [show._id, fileData.seasonNumber, fileData.episodeNumber]}
  , (err, body) -> 
    if err then throw err
    
    {fileTitle, filePath, fileSize} = fileData
    fileSizePath = [fileSize, filePath]
    
    if body.rows.length > 0 
      episode = body.rows[0].value
      haveFilePath = no
      for sizePath in episode.filePaths
        if sizePath[1] is filePath
          haveFilePath = yes
          break
      if not haveFilePath
        episode = Object.assign fileData, episode
        episode.filePaths.push fileSizePath
    else
      episode = fileData
      episode.filePaths = [fileSizePath]
        
    delete episode.fileTitle
    delete episode.filePath
    delete episode.fileSize
    
    buildArgs = {newShow, fileTitle, filePath, show, episode}  
    if not (tvdbEpisodes = show.episodes)
      tvdb.getEpisodesByTvdbShowId show.tvdbId, (err, tvdbEpisodes) ->
        if err then throw err
        buildEpisode buildArgs, tvdbEpisodes, cb
    else    
      buildEpisode buildArgs, tvdbEpisodes, cb

addShowFileTitle = (newShow, show, fileData, cb) ->
  {fileTitle} = fileData
  if show.fileTitles and fileTitle not in show.fileTitles
    show.fileTitles.push fileTitle
    db.put show, (err) ->
      if err then throw err
      checkEpisode newShow, show, fileData, cb
  else
    checkEpisode newShow, show, fileData, cb

exports.checkFile = (filePath, cb) ->
  if /(\.[^\.]{6}|\.filepart)$/i.test filePath
    fs.appendFileSync 'files/partials.txt', 'rm -rf "' + filePath + '"\n'
    setImmediate cb
    return
    
  if not (fileData = exports.getFileData filePath)
    setImmediate cb
    return
  {filePath, fileTitle} = fileData
  
  db.view 'episodeByFilePath', {key: filePath}, (err, body) -> 
    if err then throw err
    
    if body.rows.length > 0
      episode =  body.rows[0].value
      if episode.tvdbId then cb()
      else 
        db.get episode.showId, (err, show) ->
          if err then throw err
          addShowFileTitle no, show, fileData, cb
      return
      
    db.view 'showByFileTitle', {key: fileTitle}, (err, body) -> 
      if err then throw err
      
      if body.rows.length > 0
        show = body.rows[0].value
        addShowFileTitle no, show, fileData, cb
      else
        tvdb.getShowByName fileTitle, (err, show) ->
          if err then throw err
          if not show then cb(); return
          addShowFileTitle yes, show, fileData, cb

if process.argv[2] is 'all'      
  files = fs.listTreeSync videosPath
  dbgCnt = 0
  do oneFile = ->
    if not (filePath = files.shift()) or ++dbgCnt > 9
      log 'done'
      return
    exports.checkFile filePath, oneFile
      
###
{
   "_id": "_design/all",
   "_rev": "1-c133a2575ab76cfbdcb2f874c72d8bd1",
   "language": "javascript",
   "views": {
       "showByFileTitle": {
           "map": "function(doc) { \n  if (doc.type == 'show' && doc.fileTitles)\n    for(i=0; i < doc.fileTitles.length; i++)\n      emit(doc.fileTitles[i], doc);\n}"
       },
       "episodesByShowId": {
           "map": "function(doc) {\n  if (doc.type == 'episode')\n    emit(doc.showId, null);\n}"
       },
       "episodeByShowSeasonEpisode": {
           "map": "function(doc) {\n  if (doc.type == 'episode')\n    emit([doc.showId, doc.seasonNumber, doc.episodeNumber], doc);\n}"
       },
       "episodeByFilePath": {
           "map": "function(doc) { \n  if (doc.type == 'episode' && doc.filePaths)\n    for(i=0; i < doc.filePaths.length; i++)\n      emit(doc.filePaths[i][1], doc);\n}\n"
       }
   }
}

GUESSIT
    [ 'mimetype', 'video/mp4' ],
    [ 'episodeNumber', '9' ],
    [ 'container', 'mp4' ],
    [ 'format', 'HDTV' ],
    [ 'series', 'about a boy' ],
    [ 'releaseGroup', 'lol' ],
    [ 'season', '2' ]

fileData:    
  { mimetype: 'video/x-matroska',
    episodeNumber: '20',
    videoCodec: 'h264',
    container: 'mkv',
    format: 'WEB-DL',
    releaseGroup: 'NTb',
    audioChannels: '5.1',
    screenSize: '720p',
    season: '2',
    type: 'episode',
    series: 'About a Boy' 
  }
  
fileData:    
  fileTitle: 'About a Boy' 
  seasonNumber: 2
  episodeNumber: 20
  
###
  