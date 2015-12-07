
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
  stats       = fs.statSync filePath
  if not stats.isFile() then cb(); return
  fileSize    = stats.size
  fileModTime = stats.mtime 
    
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
    fileTitle     =  fileData.fileTitle
    seasonNumber  = +fileData.season
    episodeNumber = +fileData.episodeNumber
  {filePath, fileSize, fileModTime, fileTitle, seasonNumber, episodeNumber}

seasonsChecked = {}
dbPutEpisode = (showId, episode, tvdbEpisodes, cb) ->
  episode._id   ?= uuid()
  episode.type   = 'episode'
  episode.showId = showId
  deleteNullProps episode
  db.put episode, (err) ->
    if err then throw err
    
    key = showId + '-' + episode.seasonNumber
    if seasonsChecked[key] then cb(); return
    seasonsChecked[key] = yes
    
    db.view 'episodeByShowSeasonEpisode',
            {startKey: [showId, episode.seasonNumber, null],
             endKey:   [showId, episode.seasonNumber, {}]}, (err, body) -> 
      if err then throw err
      dbEpisodeNumbers = []
      for row in body.rows
        dbEpisodeNumbers.push row.key[2]
        
      do oneEpisode = ->
        if not (episode = tvdbEpisodes.shift()) then cb(); return
        if episode.episodeNumber in dbEpisodeNumbers then oneEpisode(); return
        
        # should we patch episodes with no tvdbId here?   TODO  XXX
        
        # what about episodes coming later from files?    TODO  XXX
        
        episode._id       = uuid()
        episode.type      = 'episode'
        episode.filePaths = []
        db.put episode, (err) ->
          if err then throw err
          oneEpisode()

buildEpisode = (buildArgs, tvdbEpisodes, cb) ->
  {newShow, fileData, fileTitle, filePath, show, episode} = buildArgs
  
  for tvdbEpisode in tvdbEpisodes ? []
    if tvdbEpisode.episodeNumber is fileData.episodeNumber
      Object.assign episode, tvdbEpisode
      break
      
  if not episode.tvdbId
    fs.appendFileSync 'files/files-no-tvdb', 
                      'mv "' + filePath + '" "' + filePath + '"\n'
  if newShow      
    show._id        = uuid()
    show.type       = 'show'
    show.fileTitles = [fileTitle]
    delete show.episodes
    deleteNullProps show
    db.put show, (err) ->
      if err then throw err
      dbPutEpisode show._id, episode, tvdbEpisodes, cb
      
  else
    if not tvdbEpisodes 
      tvdb.getEpisodesByTvdbShowId show.tvdbId, (err, tvdbEpisodes) ->
        if err then throw err
        dbPutEpisode show._id, episode, tvdbEpisodes, cb
    else
      dbPutEpisode show._id, episode, tvdbEpisodes, cb
  
checkEpisode = (newShow, show, fileData, cb) ->
  db.view 'episodeByShowSeasonEpisode',
          {key: [show._id, fileData.seasonNumber, fileData.episodeNumber]},
          (err, body) -> 
    if err then throw err
    
    {fileTitle, filePath, fileSize, fileModTime} = fileData
    fileSizePath = [fileSize, filePath]
    
    if body.rows.length is 0 
      episode = fileData
      episode.filePaths = [fileSizePath]
      delete episode.fileTitle
      delete episode.filePath
      delete episode.fileSize
    else
      episode = body.rows[0].value
      haveFilePath = no
      for sizePath in episode.filePaths
        if sizePath[1] is filePath
          haveFilePath = yes
          break
      if not haveFilePath
        episode.filePaths.push fileSizePath
    
    buildArgs = {newShow, fileData, fileTitle, filePath, show, episode}  
    if not (tvdbEpisodes = show.episodes) and not episode.tvdbId and
       fileModTime * 1e3 > (Date.now() - 7*24*60*60e3
      tvdb.getEpisodesByTvdbShowId show.tvdbId, (err, tvdbEpisodes) ->
        if err then throw err
        buildEpisode buildArgs, tvdbEpisodes, cb
        
    else    
      buildEpisode buildArgs, tvdbEpisodes, cb
      
exports.checkFile = (filePath, cb) ->
  if /(\.[^\.]{6}|\.filepart)$/i.test filePath
    fs.appendFileSync 'files/partial.txt', 'rm -rf "' + filePath + '"\n'
    setImmediate cb
    return
    
  if not (fileData = exports.getFileData filePath) then setImmediate cb; return
  {filePath, fileTitle} = fileData
  
  db.view 'episodeByFilePath', {key: filePath}, (err, body) -> 
    if err then throw err
    if body.rows.length > 0
      episode =  body.rows[0].value
      if episode.tvdbId then cb()
      else 
        db.get episode.showId, (err, show) ->
          if err then throw err
          checkEpisode no, show, fileData, cb
      return
      
    db.view 'showByFileTitle', {key: fileTitle}, (err, body) -> 
      if err then throw err
      if body.rows.length > 0
        show = body.rows[0].value
        if fileTitle not in show.fileTitles
          show.fileTitles.push fileTitle
          db.put show, (err) ->
            if err then throw err
            checkEpisode no, show, fileData, cb
        else
          checkEpisode no, show, fileData, cb
      else
        tvdb.getShowByName fileTitle, (err, show) ->
          if err then throw err
          if not show then cb(); return
          checkEpisode yes, show, fileData, cb

log process.argv
if process.argv[2] is 'all'      
  files = fs.listTreeSync videosPath
  dbgCnt = 0
  do oneFile = ->
    if not (filePath = files.shift()) or ++dbgCnt > 9
      log 'done'
      return
    exports.checkFile, filePath, oneFile
      
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
  