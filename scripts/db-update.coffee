
log = (args...) -> 
  console.log.call console, 'dbupdt:', args...

fs   = require 'fs-plus'
util = require 'util'
exec = require('child_process').spawnSync
tvdb = require '../server/tvdb'
db   = require '../server/db'

videosPath = '/mnt/media/videos/'

incSeq    = 0
incLabels = {}
incs      = {}
inc = (lbl) -> 
  # log lbl
  if not (incsLbl = incs[lbl])
    seqTxt = ++incSeq + ''
    if seqTxt.length < 2 then seqTxt = ' ' + seqTxt
    incLabels[lbl] = seqTxt + ' ' + lbl
    incs[lbl] = 0
  incs[lbl]++
dumpInc = ->
  log()
  for k, v of incs
    log incLabels[k] + ': ' + v

fatal = (err) ->
  log 'fatal err:', util.inspect err, depth:null
  dumpInc()
  console.trace()
  process.exit 0

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
      [__, key, val] = match
      res[key] = val
  res

exports.getFileData = (filePath) ->
  inc 'getFileData'
  stats    = fs.statSync filePath
  fileSize = stats.size
  # if not stats.isFile() then cb(); return
    
  fileData = guessit filePath
  if not fileData.series
    fs.appendFileSync 'files/file-no-series.txt', 'mv "' + filePath + '" "' + filePath + '"\n'
    return null
    
  filePath  = filePath.replace videosPath, ''
  fileTitle = fileData.series.replace /\s*\(\d+\)\s*$|\s*\[[^\]]+\]\s*$/g, ''
  fileTitle = fileTitle.replace /^(the\s+|aaf-|daa-)/i, ''
  fileTitle = fileTitle.toLowerCase()
  fileTitle = switch fileTitle
    when 'buffy'                           then 'buffy the vampire slayer'
    when 'mst3k'                           then 'mystery science theater 3000'
    when 'mst3k (cu)'                      then 'mystery science theater 3000'
    when 'cicgc'                           then 'comedians in cars getting coffee'
    when 'amazon pilot season'             then 'amazon pilot season fall 2015 good girls'
    when 'bob servant'                     then 'bob servant independent'
    when 'miranda christmas special'       then 'miranda'
    when 'sex and drugs and rock and roll' then 'sex, chips & rock n\' roll'
    when 'sex drugs and rock and roll'     then 'sex, chips & rock n\' roll'
    when 'tmawl'                           then 'that mitchell and webb look'
    when 'archer'                          then 'archer (2009)'
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
  log new Date().toString()[0..20], show.tvdbTitle
  show._id  = uuid()
  show.type = 'show'
  delete show.episodes
  deleteNullProps show
  inc 'loading banners'
  tvdb.downloadBannersForShow show, ->
    inc 'banners loaded'
    db.put show, (err) ->
      if err then fatal err
      inc 'put new show'
      cb()

dbPutEpisode = (episode, cb) ->
  episode._id ?= uuid()
  episode.type = 'episode'
  delete episode.fileTitle
  delete episode.filePath
  delete episode.fileSize
  deleteNullProps episode
  db.put episode, (err) ->
    if err then fatal err
    inc 'put episode'
    # log 'dbPutEpisode', episode
    cb()
      
getEpisode = (show, fileData, cb) ->
  {fileTitle, filePath, fileSize} = fileData
  fileSizePath = [fileSize, filePath]
    
  db.view 'episodeByShowSeasonEpisode',
    {key: [show._id, fileData.seasonNumber, fileData.episodeNumber]}
  , (err, body) -> 
    if err then fatal err
    
    if (episode = body.rows[0]?.value)
      inc 'old episode from file'
      
      if episode.tvdbEpisodeId
        inc 'old episode with tvdb'
        haveFilePath = no
        for sizePath in episode.filePaths
          if sizePath[1] is filePath
            haveFilePath = yes
            break
        if haveFilePath
          inc 'complete old episode'
          cb()
          return
          
        inc 'add file to tvdb episode'
        episode = Object.assign fileData, episode
        episode.filePaths.push fileSizePath
        dbPutEpisode episode, cb
        return
        
      inc 'old episode no tvdb'
      cb()
      return
      
    inc 'new file episode no tvdb'
    fs.appendFileSync 'files/episode-no-tvdb.txt', 
                      'mv "' + filePath + '" "' + filePath + '"\n'
    episode = fileData
    episode.filePaths = [fileSizePath]
    dbPutEpisode episode, cb

addTvdbEpisodes = (show, fileData, tvdbEpisodes, cb) ->
  if not (tvdbEpisode = tvdbEpisodes.shift())
    getEpisode show, fileData, cb
    return
  
  inc 'tvdb episodes'
  db.view 'episodeByShowSeasonEpisode',
          {key: [show._id, tvdbEpisode.seasonNumber, tvdbEpisode.episodeNumber]}
  , (err, body) -> 
    if err then fatal err
    
    if body.rows.length > 0
      addTvdbEpisodes show, fileData, tvdbEpisodes, cb
      return
      
    inc 'new tvdb episode'
    Object.assign tvdbEpisode,
      showId:    show._id
      filePaths: []
    dbPutEpisode tvdbEpisode, ->
      addTvdbEpisodes show, fileData, tvdbEpisodes, cb

chkTvdbEpisodes = (show, fileData, cb) ->
  if not (tvdbEpisodes = show.episodes)
    inc 'tvdb get episodes'
    if not show.tvdbShowId
      log 'chkTvdbEpisodes no tvdbShowId', show
      console.trace()
      process.exit 0
    tvdb.getEpisodesByTvdbShowId show.tvdbShowId
    , (err, tvdbEpisodes) ->
      if err then fatal err
      addTvdbEpisodes show, fileData, tvdbEpisodes, cb
  else    
    delete show.episodes
    addTvdbEpisodes show, fileData, tvdbEpisodes, cb

exports.checkFile = (filePath, cb) ->
  if /(\.[^\.]{6}|\.filepart)$/i.test filePath
    fs.appendFileSync 'files/partials.txt', 'rm -rf "' + filePath + '"\n'
    setImmediate cb
    return
    
  if not (fileData = exports.getFileData filePath)
    inc 'no filedata'
    setImmediate cb
    return
  {filePath, fileTitle} = fileData
  
  db.view 'episodeByFilePath', {key: filePath}, (err, body) -> 
    if err then fatal err

    if body.rows.length > 0
      inc 'got episodeByFilePath'
      episode =  body.rows[0].value
      if episode.tvdbEpisodeId
        inc 'skipping complete episode'
        cb()
      else 
        inc 're-checking episode with no tvdb'
        db.get episode.showId, (err, show) ->
          if err then fatal err
          if show.compact_running?
            log 'compact_running', episode
            console.trace()
            process.exit 0
          chkTvdbEpisodes show, fileData, cb
      return
      
    db.view 'showByFileTitle', {key: fileTitle}, (err, body) -> 
      if err then fatal err
      
      if body.rows.length > 0
        inc 'got showByFileTitle'
        show = body.rows[0].value
        chkTvdbEpisodes show, fileData, cb
        
      else
        inc 'tvdb show lookup'
        tvdb.getShowByName fileTitle, (err, show) ->
          if err then fatal err
          
          if not show
            inc 'file with no tvdb'
            fs.appendFileSync 'files/files-no-tvdb.txt', 
                              'mv "' + filePath + '" "' + filePath + '"\n'
            cb()
            return
            
          db.view 'showByTvdbShowId', 
            {key: show.tvdbShowId}
          , (err, body) ->
            if err then fatal err
            
            if body.rows.length > 0
              inc 'add filetitle to show in db'
              if not show.fileTitles
                fatal ['no show.fileTitles', show]
              if fileTitle not in show.fileTitles
                show.fileTitles.push fileTitle
                db.put show, (err) ->
                  if err then fatal err
                  chkTvdbEpisodes show, fileData, cb
              else
                chkTvdbEpisodes show, fileData, cb
              return
              
            inc 'adding new show from tvdb'
            show.fileTitles = [fileTitle]
            dbPutShow show, (err) ->
              if err then fatal err
              chkTvdbEpisodes show, fileData, cb

if process.argv[2] is 'all'
  files = fs.listTreeSync videosPath
  do oneFile = ->
    if not (filePath = files.shift()) # or filePath.indexOf('Armstrong') > -1
      log 'done'
      dumpInc()
      return
    inc 'checkFile'
    if incs.checkFile % 100 is 0 then dumpInc()
    exports.checkFile filePath, oneFile

###
{
   "_id": "_design/all",
   "language": "javascript",
   "views": {
       "showByFileTitle": {
           "map": "function(doc) { \n  if (doc.type == 'show' && doc.fileTitles)\n    for(i=0; i < doc.fileTitles.length; i++)\n      emit(doc.fileTitles[i], doc);\n}"
       },
       "episodeByShowSeasonEpisode": {
           "map": "function(doc) {\n  if (doc.type == 'episode')\n    emit([doc.showId, doc.seasonNumber, doc.episodeNumber], doc);\n}"
       },
       "episodeByFilePath": {
           "map": "function(doc) { \n  if (doc.type == 'episode' && doc.filePaths)\n    for(i=0; i < doc.filePaths.length; i++)\n      emit(doc.filePaths[i][1], doc);\n}\n"
       },
       "showByTvdbShowId": {
           "map": "function(doc) {\n  if(doc.type == 'show' && doc.tvdbShowId)\n    emit(doc.tvdbTitle, null);\n}"
       }
   }
}
###