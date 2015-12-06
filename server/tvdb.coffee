
log = (args...) -> 
  console.log.apply console, ['tvdb:'].concat args

TVDB = require 'node-tvdb/compat'
tvdb = new TVDB '2C92771D87CA8718'

exports.getShow = (name, cb) ->
  showRes = {}
  tvdb.getSeriesByName name, (err, res) ->
    if err then throw err
    if res.length is 0
      log 'no tvdb match', name
      cb null, {}
      return
    if res.length > 1
      log 'multiple tvdb series', res
    {seriesid, SeriesName, Overview, FirstAired,
               Network, IMDB_ID, zap2it_id} = res[0]
    showRes = {tvdbId: seriesid, tvdbTitle: SeriesName, Overview, 
               FirstAired, Network, IMDB_ID, zap2it_id}
    
    tvdb.getSeriesAllById seriesid, (err, res) ->
      log res.Episodes
               
    # showRes.banners = {urlPfx}
    # urlPfx = 'http://thetvdb.com/banners/'
    # tvdb.getBanners seriesid, (err, res) ->
    #   if err then throw err
    #   for banner in res
    #     {BannerType, BannerType2, BannerPath,ThumbnailPath} = banner
    #     key = BannerType + '-' + BannerType2
    #     if key.indexOf('season') > -1 then continue
    #     showRes.banners[key] ?= []
    #     showRes.banners[key].push  {BannerPath, ThumbnailPath}
    #   tvdb.getActors seriesid, (err, res) ->
    #     if err then throw err
    #     showRes.actors = res
    #   
    #     cb null, showRes

exports.getShow 'About a Boy', (err, res) ->
  log res

###  TVDB
  acct id F6DF9C666C2A3259
  user id 444819
  api key 2C92771D87CA8718
 
  getSeriesByName - Get basic series information by name
  getSeriesById - Get basic series information by id
  getSeriesAllById - Get full/all series information by id
  getEpisodesById - Get all episodes by series id
  getEpisodeById - Get episode by episode id
  getActors - Get series actors by series id
  getEpisodeByAirDate- Get series episode by air date
  getBanners - Get series banners by series id
  getUpdates - Get series and episode updates since a given unix timestamp
  utils.parsePipeList - Parse pipe list string to javascript array


tvdb: { err: null,
  res: 
   [ { seriesid: '269593',
       language: 'en',
       SeriesName: 'About a Boy',
       banner: 'graphical/269593-g7.jpg',
       Overview: 'Based on the best-selling Nick Hornby novel, written/produced by Jason Katims and directed by Jon Favreau comes a different kind of coming-of-age story. Will Freeman lives a charmed existence as the ultimate man-child. After writing a hit song, he was granted a life of free time, free love and freedom from financial woes. He’s single, unemployed and loving it. So imagine his surprise when Fiona, a needy, single mom and her oddly charming 11-year-old son Marcus move in next door and disrupt his perfect world.',
       FirstAired: '2014-02-22',
       Network: 'NBC',
       IMDB_ID: 'tt2666270',
       zap2it_id: 'EP01738426',
       id: '269593' } ] }

tvdb: getBanners { id: '269593',
  err: null,
  res: 
   [ { id: '1040952',
       BannerPath: 'fanart/original/269593-9.jpg',
       BannerType: 'fanart',
       BannerType2: '1920x1080',
       Colors: null,
       Language: 'en',
       Rating: '8.4000',
       RatingCount: '5',
       SeriesName: 'false',
       ThumbnailPath: '_cache/fanart/original/269593-9.jpg',
       VignettePath: 'fanart/vignette/269593-9.jpg' },
     { id: '1040868',
       BannerPath: 'fanart/original/269593-6.jpg',
       BannerType: 'fanart',
       BannerType2: '1920x1080',
    ... 
    
fanart 1920x1080 http://thetvdb.com/banners/fanart/original/269593-9.jpg
fanart 1920x1080 http://thetvdb.com/banners/fanart/original/269593-6.jpg
fanart 1920x1080 http://thetvdb.com/banners/fanart/original/269593-3.jpg
fanart 1920x1080 http://thetvdb.com/banners/fanart/original/269593-2.jpg
fanart 1280x720 http://thetvdb.com/banners/fanart/original/269593-5.jpg
fanart 1920x1080 http://thetvdb.com/banners/fanart/original/269593-8.jpg
fanart 1280x720 http://thetvdb.com/banners/fanart/original/269593-1.jpg
poster 680x1000 http://thetvdb.com/banners/posters/269593-4.jpg
poster 680x1000 http://thetvdb.com/banners/posters/269593-2.jpg
poster 680x1000 http://thetvdb.com/banners/posters/269593-3.jpg
poster 680x1000 http://thetvdb.com/banners/posters/269593-1.jpg
season season http://thetvdb.com/banners/seasons/269593-2-3.jpg
season season http://thetvdb.com/banners/seasons/269593-1-3.jpg
season season http://thetvdb.com/banners/seasons/269593-1-5.jpg
season season http://thetvdb.com/banners/seasons/269593-2-2.jpg
season season http://thetvdb.com/banners/seasons/269593-1.jpg
season season http://thetvdb.com/banners/seasons/269593-1-2.jpg
season season http://thetvdb.com/banners/seasons/269593-1-4.jpg
season season http://thetvdb.com/banners/seasons/269593-2.jpg
season seasonwide http://thetvdb.com/banners/seasonswide/269593-2.jpg
series graphical http://thetvdb.com/banners/graphical/269593-g5.jpg
series graphical http://thetvdb.com/banners/graphical/269593-g7.jpg
series graphical http://thetvdb.com/banners/graphical/269593-g6.jpg
series graphical http://thetvdb.com/banners/graphical/269593-g4.jpg
series graphical http://thetvdb.com/banners/graphical/269593-g2.jpg
series graphical http://thetvdb.com/banners/graphical/269593-g.jpg
series graphical http://thetvdb.com/banners/graphical/269593-g3.jpg  
###
