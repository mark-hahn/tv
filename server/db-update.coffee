
log = (args...) -> 
  console.log.call console, 'dbupdt:', args...

fs   = require 'fs-plus'
util = require 'util'
exec = require('child_process').spawnSync
tvdb = require './tvdb'
db   = require './db'

mappings = [
  ['buffy'                           , 'Buffy The Vampire Slayer']
  ['mst3k'                           , 'Mystery Science Theater 3000']
  ['cicgc'                           , 'Comedians In Cars Getting Coffee']
  ['sex and drugs and rock and roll' , 'Sex&Drugs&Rock&Roll']
  ['sex drugs and rock and roll'     , 'Sex&Drugs&Rock&Roll']
  ['tmawl'                           , 'That Mitchell And Webb Look']
  ['archer'                          , 'Archer (2009)']
  ['Playhouse Presents Psychobitches', 'Psychobitches']
  ['Last Man Standing',                'Last Man Standing (US)']
  ['Louie',                            'Louie (2010)']
]

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
  console.log()
  for k, v of incs then log incLabels[k] + ': ' + v
  bad = 0
  for badLbl in [
      'file no tvdb show' 
      'bad-file-no-series' 
      'bad-file-bad-number'
      'new episode no tvdb']
    bad += incs[badLbl] ? 0
  total = incs.checkFile
  log bad, 'of', total, 'bad, ', Math.round(bad*100/total) + '%'
  console.log()

fatal = (err) ->
  log 'fatal err...'
  if err then log util.inspect err, depth:null
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

getBitRate = (filePath) ->
  {output, stdErr} = exec 'mediainfo', ['--Output=XML', filePath]
  matches = /<track\stype="Video">([\S\s]*?<\/track>)/i.exec output.toString()
  output = matches?[1] ? ''
  matches  = /<Overall_bit_rate>(\d+\s+)?([\d\.]+)\s+(\w+)<\/Overall_bit_rate>/i
              .exec output.toString()
  matches ?= /<Bit_rate>(\d+\s+)?([\d\.]+)\s+(\w+)<\/Bit_rate>/i
              .exec output.toString()
  matches ?= [null, null, 0, 'Kbps']
  switch matches[3]
    when 'Kbps' then rate = +matches[2] * 1024
    when 'Mbps' then rate = +matches[2] * 1024 * 1024
    else
      log 'bit rate units err', matches
      fatal()
  if rate > 10e6
    fs.appendFileSync 'files/high-bitrate.txt', 
      matches[2] + ' ' + matches[3] + ' ' + rate + ' ' + filePath + '\n'
  rate

exports.guessit = (filePath) ->
  fileName = filePath.replace '/mnt/media/videos/', ''
  fileName = fileName.replace /[^\x20-\x7e]/g, ''
                     .replace /\(GB\)/i, '(UK)'
                     .replace /[\.\s]UK[\.\s]/i, ' (UK) '
                     .replace 'faks86', ''
                     
  if filePath in [
        'Rik Mayall Presents  - s01e09 - Briefest Encounter.avi'
        'The.Comedians.US.S01E01.720p.HDTV.x264-KILLERS.mkv'
      ]
    fs.appendFileSync 'files/episode-no-tvdb.txt', 
                      filePath + ' => ' + fileName + '\n'
  
  {output} = exec 'guessit', [fileName], timeout: 10e3
  
  json = output.toString().replace /^[\s|\S]*?GuessIt\s+found\:\s+/i, ''
  try
    res = JSON.parse json.replace /[^\}]*$/, ''
  catch e
    fs.appendFileSync 'files/guessit-parse-error.txt', 
      output.toString() + '\n' + json + '\n'
    return []
  
  if res.year
    res.title = res.title + ' (' + res.year + ')'
  if res.country is 'UNITED KINGDOM' and 
       not /\(UK\)/i.test res.title
    res.title = res.title + ' (UK)'
  
  episodes = []
  switch typeof res.season + typeof res.episode
    when 'objectnumber'
      for seasonNumber in res.season.slice()
        res.season = +seasonNumber
        episodes.push res
    when 'numberobject'
      for episodeNumber in res.episode.slice()
        res.episode = +episodeNumber
        episodes.push res
    when 'objectobject'
      episodeNumbers = res.episode.slice()
      for seasonNumber, idx in res.season.slice()
        res.season  = +seasonNumber
        res.episode = +episodeNumbers[idx]
        episodes.push res
    else episodes = [res]
  episodes

exports.getFileData = (filePath) ->
  inc 'getFileData'
  stats    = fs.statSync filePath
  fileSize = stats.size
  if not stats.isFile() then return 'not-file'
  bitRate = getBitRate filePath
  
  episodes = exports.guessit filePath
  
  if not (fileData = episodes[0]) then return 'no-guessit'
  if not (series = fileData.title) then return 'no-series'
  
  fileTitle = series
  for map in mappings
    regex = new RegExp(
      fileTitle.replace(/[\-\[\]\/\{\}\(\)\*\+\?\\\^\$\|]/g, '\\$&'), 'i')
    if regex.test map[0]
      fileTitle = map[1]
      break
  fileTitle = fileTitle.replace /\./g, ' '
                       .replace /^(aaf-|daa-)/i, ''
  if (isNaN(fileData.season) or isNaN(fileData.episode)) 
    return 'bad-number'
    
  seasonNumber  = +fileData.season
  episodeNumber = +fileData.episode
  
  if fileTitle is 'the' then fileTitle = 'The Spa'
  fileCountry = fileData.country
  if episodes.length > 1
    multipleEpisodes = 
      for episode in episodes
        [episode.seasonNumber, episode.episodeNumber]
  else
    multipleEpisodes = null      
  fileEpisodeTitle = fileData.episode_title
  
  {filePath, fileSize, bitRate, fileTitle, seasonNumber, 
   episodeNumber, multipleEpisodes, fileEpisodeTitle, fileCountry}

dbPutShow = (show, cb) ->
  log new Date().toString()[0..20], show.tvdbTitle
  show._id  = uuid()
  show.type = 'show'
  delete show.episodes
  deleteNullProps show
  tvdb.downloadBannersForShow show, ->
    db.put show, (err) ->
      if err then fatal err
      inc 'put new show'
      cb()

dbPutEpisode = (episode, cb) ->
  episode._id ?= uuid()
  episode.type = 'episode'
  episode.episodeTitle ?= episode.fileEpisodeTitle
  delete episode.fileEpisodeTitle
  delete episode.fileSize
  delete episode.bitRate
  delete episode.filePath
  deleteNullProps episode
  
  if not episode.showId
    log 'no episode.showId', filePath
    fatal episode

  tvdb.downloadBanner episode.thumb, ->
    db.put episode, (err) ->
      if err then fatal err
      inc 'put episode'
      # log 'dbPutEpisode', episode
      cb()
      
getEpisode = (show, fileData, cb) ->
  {fileTitle, filePath, fileSize, bitRate} = fileData
  fileSizePath = [fileSize, bitRate, filePath]
    
  db.view 'episodeByShowSeasonEpisode',
    {key: [show._id, fileData.seasonNumber, fileData.episodeNumber]}
  , (err, body) -> 
    if err then fatal err
    
    if (episode = body.rows[0]?.value)
      if episode.tvdbEpisodeId
        haveFilePath = no
        for sizePath in episode.filePaths
          if sizePath[2] is filePath
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
      
    inc 'new episode no tvdb'
    fs.appendFileSync 'files/episode-no-tvdb.txt', 
                      'mv "' + filePath + '" "' + filePath + '"\n'
    episode           = fileData
    episode.showId    = show._id
    episode.filePaths = [fileSizePath]
    dbPutEpisode episode, cb

addTvdbEpisodes = (show, fileData, tvdbEpisodes, cb) ->
  if not (tvdbEpisode = tvdbEpisodes.shift())
    getEpisode show, fileData, cb
    return
  
  inc 'episode from tvdb'
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
      fatal()
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
    
  fileData = exports.getFileData filePath
  if fileData is 'not-file'  then setImmediate cb; return
  if typeof fileData is 'string'
    inc 'bad-file-' + fileData
    fs.appendFileSync 'files/file-' + fileData + '.txt', 'rm -rf "' + filePath + '"\n'
    setImmediate cb
    return
  {filePath, fileTitle} = fileData
  
  db.view 'episodeByFilePath', {key: filePath}, (err, body) -> 
    if err then fatal err

    if body.rows.length > 0
      inc 'got episode by filepath'
      episode =  body.rows[0].value
      if episode.tvdbEpisodeId
        inc 'skipping complete episode'
        cb()
      else 
        inc 're-checking episode with no tvdb'
        if not episode.showId
          log 'no episode.showId', filePath
          fatal body
        db.get episode.showId, (err, show) ->
          if err then fatal err
          if show.compact_running?
            log 'compact_running', episode
            fatal()
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
            inc 'file no tvdb show'
            fs.appendFileSync 'files/file-no-tvdb-show.txt', 
                              'mv "' + filePath + '" "' + filePath + '"\n'
            cb()
            return
          
          db.view 'showByTvdbShowId', 
            {key: show.tvdbShowId}
          , (err, body) ->
            if err then fatal err
            
            if (oldShow = body.rows[0]?.value)
              inc 'add filetitle to show'
              if fileTitle not in oldShow.fileTitles
                oldShow.fileTitles.push fileTitle
                db.put oldShow, (err) ->
                  if err then fatal err
                  chkTvdbEpisodes oldShow, fileData, cb
              else
                chkTvdbEpisodes oldShow, fileData, cb
              return
              
            inc 'new show from tvdb'
            show.fileTitles = [fileTitle]
            dbPutShow show, (err) ->
              if err then fatal err
              chkTvdbEpisodes show, fileData, cb

# log exports.getFileData videosPath + 'The.Soup.S1E1.HDTV.x264-FiHTV.mp4'
# exports.checkFile videosPath + 'The.Soup.S1E1.HDTV.x264-FiHTV.mp4', ->

if process.argv[2] is 'all'
  files = fs.listTreeSync videosPath
  do oneFile = ->
    if not (filePath = files.shift())
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
           "map": "function(doc) {\n  if (doc.type == 'episode' && doc.showId)\n    emit([doc.showId, doc.seasonNumber, doc.episodeNumber], doc);\n}"
       },
       "episodeByFilePath": {
           "map": "function(doc) { \n  if (doc.type == 'episode' && doc.filePaths)\n    for(i=0; i < doc.filePaths.length; i++)\n      emit(doc.filePaths[i][2], doc);\n}\n"
       },
       "showByTvdbShowId": {
           "map": "function(doc) {\n  if(doc.type == 'show' && doc.tvdbShowId)\n    emit(doc.tvdbShowId, doc);\n}"
       },
       "fileNoTvdb": {
           "map": "function(doc) { \n  if (doc.type == 'episode' && doc.filePaths && !doc.tvdbEpisodeId)\n    for(i=0; i < doc.filePaths.length; i++)\n      emit(doc.filePaths[i][2], doc);\n}\n"
       },
       "showByTvdbTitle": {
           "map": "function(doc) {\n  if (doc.type == 'show' && doc.tvdbShowId)\n    emit(doc.tvdbTitle, doc);\n}\n"
       },
       "episodeByFilenameSeasonEpisode": {
           "map": "function(doc) {\n  if (doc.type == 'episode' && doc.filePaths)\n    for (i=0; i < doc.filePaths.length; i++)\n      emit([doc.filePaths[i][2], doc.seasonNumber, doc.episodeNumber], doc);\n}"
       },
       "episodesWithFiles": {
           "map": "function(doc) {\n  if (doc.type == 'episode' && doc.showId && doc.filePaths && doc.filePaths.length > 0)\n    emit([doc.showId, doc.seasonNumber, doc.episodeNumber], doc);\n}"
       },
       "all": {
           "map": "function(doc) {\n  emit(null, null);\n}"
       }
   }
}
###