
log = (args...) -> 
  console.log.apply console, ['tvdb:'].concat args

fs   = require 'fs-plus'
url  = require 'url'
path = require 'path'
http = require 'http'
util = require 'util'
Fuzz = require 'fuzzyset.js'
TVDB = require 'node-tvdb/compat'
tvdb = new TVDB '2C92771D87CA8718'
request = require 'request'
parsePipeList = TVDB.utils.parsePipeList

showsByName         = {}
episodeListByTvdbId = {}

cleanEpisodes = (episodes) ->
  if episodes
    for episode in episodes
      {id, EpisodeName, EpisodeNumber, FirstAired, GuestStars, IMDB_ID, 
        Overview, SeasonNumber, filename, thumb_height, thumb_width} = episode
      {tvdbEpisodeId: id, episodeTitle: EpisodeName, \
       seasonNumber: +SeasonNumber, episodeNumber: +EpisodeNumber,
       aired: FirstAired, guestStars: GuestStars, imdbEpisodeId: IMDB_ID,
       summary: Overview, thumb: filename, 
       thumbW: +thumb_width or null, thumbH: +thumb_height or null}

cleanActors = (actors) ->
  if actors
    for actor in actors
      {Image, Name, Role} = actor
      {thumb: Image, name: Name, role: Role}

getSeriesIdByName = (showNameIn, cb) ->
  seriesId = null
  tvdb.getSeriesByName showNameIn, (err, res) ->
    if err then throw err
    allSeries = res
    if not res then cb(); return
    
    switch res.length
      when 0 then cb(); return
      when 1 then seriesId = allSeries[0].seriesid
      else
        # log 'allSeries', allSeries
        titles = []
        for series in allSeries
          titles.push series.SeriesName
        fuzz    = new Fuzz titles
        fuzzRes = fuzz.get showNameIn
        if fuzzRes.length is 0 then cb {tvdbRes: res, fuzzRes}; return
        score = fuzzRes[0][0]
        title = fuzzRes[0][1]
        if score < 0.65 then cb {tvdbRes: res, fuzzRes}; return
        for series in allSeries
          if series.SeriesName is title
            seriesId = series.seriesid
            break
    cb null, seriesId
  
exports.getShowByName = (showNameIn, cb) ->
  if (show = showsByName[showNameIn]) then cb null, show; return
  if show is null then cb(); return
  
  noMatch = (details) ->
    log 'no tvdb match', showNameIn, details
    fs.appendFileSync 'files/show-no-tvdb.txt', 
                       showNameIn + '  ' + util.inspect(details, depth:null) + '\n'
    showsByName[showNameIn] = null
    setImmediate cb
    
  getSeriesIdByName showNameIn, (err, seriesId) ->
    if err then noMatch err; return
    if not seriesId
      showsByName[showNameIn] = null
      cb()
      return
    
    tvdb.getSeriesAllById seriesId, (err, tvdbSeries) ->
      if err then throw err
      {Airs_DayOfWeek, Airs_Time, FirstAired, Genre, IMDB_ID, 
        Network, Overview, Runtime, SeriesName, 
        Status, zap2it_id, Episodes} = tvdbSeries
      showRes = {tvdbShowId: seriesId, tvdbTitle: SeriesName, \
                 imdbShowId: IMDB_ID, zap2itShowId: zap2it_id,
                 day: Airs_DayOfWeek, time: Airs_Time, 
                 started: FirstAired, tags: parsePipeList(Genre ? ''),
                 network: Network, summary: Overview, 
                 length: (+Runtime)*60, status: Status}
                 
      showRes.episodes = episodeListByTvdbId[seriesId] = 
        cleanEpisodes Episodes
      
      showRes.banners = {}
      tvdb.getBanners seriesId, (err, banners) ->
        if err then throw err
        if banners
          for banner in banners
            {BannerType, BannerType2, BannerPath,ThumbnailPath} = banner
            key = BannerType + '-' + BannerType2
            if key.indexOf('season') > -1 then continue
            showRes.banners[key] ?= []
            showRes.banners[key].push  {BannerPath, ThumbnailPath}
        tvdb.getActors seriesId, (err, actors) ->
          if err then throw err
          if actors
            showRes.actors = cleanActors actors
          showsByName[showNameIn] = showRes
          
          cb null, showRes

exports.getEpisodesByTvdbShowId = (id, cb) ->
  if not id
    log 'no id in getEpisodesByTvdbShowId'
    console.trace()
    process.exit 0
    
  if (episodes = episodeListByTvdbId[id]) then cb null, episodes; return
  
  tvdb.getEpisodesById id, (err, res) ->
    if err  
      log 'err from getEpisodesById'
      console.trace()
      process.exit 0
    episodeListByTvdbId[id] = episodes = cleanEpisodes res
    cb null, episodes

# getBanner = (file, cb) ->
#   uri      = 'http://thetvdb.com/banners/' + file
#   filename = '/archive/tvdb-banners/'      + file
#   metaName = filename + '.json'
#   try 
#     stats    = fs.statSync filename
#     fileSize = stats.size
#     meta     = JSON.parse fs.readFileSync metaName, 'utf8'
#     if +meta.length is fileSize then setImmediate ->
#       # log 'getBanner skipping', file
#       cb null, meta
#     return
#   catch e
#   if fileSize?
#     fs.removeSync filename
#     fs.removeSync metaName
#     
#   # log 'getBanner downloading', file
#   
#   fs.makeTreeSync path.dirname filename
#   fileStream = fs.createWriteStream filename
#   options = 
#     host: url.parse(uri).host
#     path: url.parse(uri).pathname
#   http.get options, (res) ->
#     res .on 'error', (err) -> 
#           fileStream.end()
#           log 'getBanner error', {file, err}
#           cb err
#         .on "data", (data) -> fileStream.write data
#         .on "end", -> 
#           fileStream.end()
#           meta = 
#             type:   res.headers["content-type"]
#             length: res.headers["content-length"]
#           fs.writeFileSync metaName, JSON.stringify meta
#           # log 'getBanner http.get end', file
#           cb null, meta
      
getBanner = (file, cb) ->
  uri      = 'http://thetvdb.com/banners/' + file
  filename = '/archive/tvdb-banners/' + file
  metaName = filename + '.json'
  fileSize = null
  try 
    stats    = fs.statSync filename
    fileSize = stats.size
    meta     = JSON.parse fs.readFileSync metaName, 'utf8'
    if +meta.length is fileSize
      setImmediate -> cb null, meta 
      return
  catch e
  if fileSize?
    fs.removeSync filename
    fs.removeSync metaName
  fs.makeTreeSync path.dirname filename
  try
    request.head uri, (err, res) ->
      if err then cb err; return
      request(uri).pipe(fs.createWriteStream(filename)).on "close", -> 
        meta = 
          type:   res.headers["content-type"]
          length: res.headers["content-length"]
        fs.writeFileSync metaName, JSON.stringify meta
        cb null, meta
  catch e
    cb e
    
exports.downloadBannersForShow = (show, cb) ->
  
  cbCount = 0
  doCb = (args...) ->
    if ++cbCount > 1
      log 'multiple callbacks in downloadBannersForShow', show
      console.trace()
      process.exit 0
    cb args...
    
  if not show.banners
    # log 'downloadBannersForShow no show.banners'
    doCb()
    return
  
  ## TODO support any flattened data like actor images
  
  allBanners = []
  for k, v of show.banners
    for k2, v2 of v
      for k3, v3 of v2
        allBanners.push v3
        
  do oneBanner = ->
    if not (banner = allBanners.shift())
      # log 'oneBanner finished'
      doCb()
      return
      
    getBanner banner, (err, meta) ->
      if err
        log 'getBanner error', banner, err
        fs.appendFileSync 'files/download-banner-errs.txt', 
                       show._id + ', ' + banner + ',  ' + err.message + '\n'
      oneBanner()
      
