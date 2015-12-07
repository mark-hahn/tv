
log = (args...) -> 
  console.log.apply console, ['tvdb:'].concat args

fs   = require 'fs-plus'
TVDB = require 'node-tvdb/compat'
tvdb = new TVDB '2C92771D87CA8718'
Fuzz = require 'fuzzyset.js'

showsByName         = {}
episodeListByTvdbId = {}

cleanEpisodes = (episodes) ->
  for episode in episodes
    {EpisodeId, EpisodeName, EpisodeNumber, FirstAired, GuestStars, IMDB_ID, 
      Overview, SeasonNumber, filename, thumb_height, thumb_width} = episode
    {tvdbId: EpisodeId, episodeTitle: EpisodeName, \
     seasonNumber: +SeasonNumber, episodeNumber: +EpisodeNumber,
     aired: FirstAired, guestStars: GuestStars, imdbId: IMDB_ID,
     summary: Overview, thumb: filename, thumbW: +thumb_width, thumbH: +thumb_height}

cleanActors = (actors) ->
  for actor in actors
    {Image, Name, Role} = actor
    {thumb: Image, name: Name, role: Role}

getSeriesIdByName = (showNameIn, cb) ->
  seriesId = null
  tvdb.getSeriesByName showNameIn, (err, res) ->
    if err then throw err
    allSeries = res
    switch res.length
      when 0 then cb(); return
      when 1 then seriesId = allSeries[0].seriesid
      else
        titles    = []
        for series in allSeries
          titles.push series.SeriesName
        fuzz    = new Fuzz showTitles
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
  if (show = showsByName[showNameIn]) then cb show; return
  if show is null then cb(); return
  
  noMatch = (details) ->
    log 'no tvdb match', showNameIn, details
    fs.appendFileSync 'files/no-tvdb-match.txt', 
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
      showRes = {tvdbId: seriesId, tvdbTitle: SeriesName, \
                 imdbId: IMDB_ID, zap2itId: zap2it_id,
                 day: Airs_DayOfWeek, time: Airs_Time, 
                 started: FirstAired, tags: Genre.split('|'),
                 network: Network, summary: Overview, 
                 length: (+Runtime)*60, status: Status}
                 
      showRes.episodes = episodeListByTvdbId[seriesId] = 
        cleanEpisodes Episodes
      
      showRes.banners = {}
      tvdb.getBanners seriesId, (err, banners) ->
        if err then throw err
        for banner in banners
          {BannerType, BannerType2, BannerPath,ThumbnailPath} = banner
          key = BannerType + '-' + BannerType2
          if key.indexOf('season') > -1 then continue
          showRes.banners[key] ?= []
          showRes.banners[key].push  {BannerPath, ThumbnailPath}
          
        tvdb.getActors seriesId, (err, actors) ->
          if err then throw err
          showRes.actors = cleanActors actors
          
          showsByName[showNameIn] = showRes
          cb null, showRes

exports.getEpisodesByTvdbShowId = (id, cb) ->
  if (episodes = episodeListByTvdbId[id]) then cb episodes; return
  
  tvdb.getEpisodesById id, (err, res) ->
    if err then throw err
    episodeListByTvdbId[id] = episodes = cleanEpisodes res
    cb episodes

# exports.getShowByName 'About a Boy', (err, show) ->
#   log 'actors', err, show.actors
# 
  
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

tvdb: { id: '269593',
  Actors: '|David Walton|Minnie Driver|Benjamin Stockham|Al Madrigal|',
  Airs_DayOfWeek: 'Tuesday',
  Airs_Time: '9:30 PM',
  ContentRating: 'TV-PG',
  FirstAired: '2014-02-22',
  Genre: '|Comedy|Drama|Romance|',
  IMDB_ID: 'tt2666270',
  Language: 'en',
  Network: 'NBC',
  NetworkID: null,
  Overview: 'Based on the best-selling Nick Hornby novel, written/produced by Jason Katims and directed by Jon Favreau comes a different kind of coming-of-age story. Will Freeman lives a charmed existence as the ultimate man-child. After writing a hit song, he was granted a life of free time, free love and freedom from financial woes. He’s single, unemployed and loving it. So imagine his surprise when Fiona, a needy, single mom and her oddly charming 11-year-old son Marcus move in next door and disrupt his perfect world.',
  Rating: '6.7',
  RatingCount: '11',
  Runtime: '30',
  SeriesID: '35281',
  SeriesName: 'About a Boy',
  Status: 'Ended',
  added: '2013-05-09 11:57:43',
  addedBy: '382000',
  banner: 'graphical/269593-g5.jpg',
  fanart: 'fanart/original/269593-9.jpg',
  lastupdated: '1447579280',
  poster: 'posters/269593-4.jpg',
  tms_wanted_old: '0',
  zap2it_id: 'EP01738426',
  Episodes: 
   [ { id: '4570034',
       Combined_episodenumber: '1',
       Combined_season: '1',
       DVD_chapter: null,
       DVD_discid: null,
       DVD_episodenumber: null,
       DVD_season: null,
       Director: 'Jon Favreau',
       EpImgFlag: '2',
       EpisodeName: 'Pilot',
       EpisodeNumber: '1',
       FirstAired: '2014-02-22',
       GuestStars: 'Leslie Bibb',
       IMDB_ID: 'tt2912482',
       Language: 'en',
       Overview: 'We follow perpetually-single Will as he attempts to woo women, while avoiding any real commitment. His life changes when a quirky, bohemian, vegan single mother, Fiona, and her 11-year-old son, Marcus, move in next door. Marcus is a misfit, and already being bullied at his new school, yet he and Will strike up an odd-couple friendship, under Fiona’s disapproving watch.',
       ProductionCode: null,
       Rating: '6.8',
       RatingCount: '6',
       SeasonNumber: '1',
       Writer: 'Jason Katims',
       absolute_number: '1',
       filename: 'episodes/269593/4570034.jpg',
       lastupdated: '1422200711',
       seasonid: '519720',
       seriesid: '269593',
       thumb_added: '2014-02-13 17:08:32',
       thumb_height: '225',
       thumb_width: '400' },
     ...

  show: 
   { tvdbId: '269593',
     tvdbTitle: 'About a Boy',
     imdbId: 'tt2666270',
     zap2itId: 'EP01738426',
     Airs_DayOfWeek: 'Tuesday',
     Airs_Time: '9:30 PM',
     FirstAired: '2014-02-22',
     Genre: '|Comedy|Drama|Romance|',
     Network: 'NBC',
     Overview: 'Based on the best-selling Nick Hornby novel, written/produced by Jason Katims and directed by Jon Favreau comes a different kind of coming-of-age story. Will Freeman lives a charmed existence as the ultimate man-child. After writing a hit song, he was granted a life of free time, free love and freedom from financial woes. He’s single, unemployed and loving it. So imagine his surprise when Fiona, a needy, single mom and her oddly charming 11-year-old son Marcus move in next door and disrupt his perfect world.',
     Runtime: '30',
     Status: 'Ended',
     episodes: 
      [ [Object],
        ...
        [Object] ],
     banners: 
      { urlPfx: 'http://thetvdb.com/banners/',
        'fanart-1920x1080': [Object],
        'fanart-1280x720': [Object],
        'poster-680x1000': [Object],
        'series-graphical': [Object] },
     actors: [ [Object], [Object], [Object], [Object] ] }   
     
one episode: 
  EpisodeId: '4570034',
  EpisodeName: 'Pilot',
  EpisodeNumber: '1',
  FirstAired: '2014-02-22',
  GuestStars: 'Leslie Bibb',
  imdbId: 'tt2912482',
  Overview: 'We follow perpetually-single Will as he attempts to woo women, while avoiding any real commitment. His life changes when a quirky, bohemian, vegan single mother, Fiona, and her 11-year-old son, Marcus, move in next door. Marcus is a misfit, and already being bullied at his new school, yet he and Will strike up an odd-couple friendship, under Fiona’s disapproving watch.',
  SeasonNumber: '1',
  Writer: 'Jason Katims',
  filename: 'episodes/269593/4570034.jpg',
  thumb_height: '225',
  thumb_width: '400'
  
banners:
  urlPfx: 'http://thetvdb.com/banners/',
  'fanart-1920x1080': 
   [ { BannerPath: 'fanart/original/269593-9.jpg',
       ThumbnailPath: '_cache/fanart/original/269593-9.jpg' },
     { BannerPath: 'fanart/original/269593-6.jpg',
       ThumbnailPath: '_cache/fanart/original/269593-6.jpg' },
     { BannerPath: 'fanart/original/269593-3.jpg',
       ThumbnailPath: '_cache/fanart/original/269593-3.jpg' },
     { BannerPath: 'fanart/original/269593-2.jpg',
       ThumbnailPath: '_cache/fanart/original/269593-2.jpg' },
     { BannerPath: 'fanart/original/269593-8.jpg',
       ThumbnailPath: '_cache/fanart/original/269593-8.jpg' } ],
  'fanart-1280x720': 
   [ { BannerPath: 'fanart/original/269593-5.jpg',
       ThumbnailPath: '_cache/fanart/original/269593-5.jpg' },
     { BannerPath: 'fanart/original/269593-1.jpg',
       ThumbnailPath: '_cache/fanart/original/269593-1.jpg' } ],
  'poster-680x1000': 
   [ { BannerPath: 'posters/269593-4.jpg', ThumbnailPath: undefined },
     { BannerPath: 'posters/269593-2.jpg', ThumbnailPath: undefined },
     { BannerPath: 'posters/269593-3.jpg', ThumbnailPath: undefined },
     { BannerPath: 'posters/269593-1.jpg', ThumbnailPath: undefined } ],
  'series-graphical': 
   [ { BannerPath: 'graphical/269593-g5.jpg',
       ThumbnailPath: undefined },
     { BannerPath: 'graphical/269593-g7.jpg',
       ThumbnailPath: undefined },
     { BannerPath: 'graphical/269593-g6.jpg',
       ThumbnailPath: undefined },
     { BannerPath: 'graphical/269593-g4.jpg',
       ThumbnailPath: undefined },
     { BannerPath: 'graphical/269593-g2.jpg',
       ThumbnailPath: undefined },
     { BannerPath: 'graphical/269593-g.jpg',
       ThumbnailPath: undefined },
     { BannerPath: 'graphical/269593-g3.jpg',
       ThumbnailPath: undefined } ] }
       
actors:
  [ { id: '326286',
    Image: 'actors/326286.jpg',
    Name: 'David Walton',
    Role: 'Will Freeman',
    SortOrder: '0' },
  { id: '326287',
    Image: 'actors/326287.jpg',
    Name: 'Minnie Driver',
    Role: 'Fiona',
    SortOrder: '1' },
  { id: '326288',
    Image: 'actors/326288.jpg',
    Name: 'Benjamin Stockham',
    Role: 'Marcus',
    SortOrder: '2' },
  { id: '326289',
    Image: 'actors/326289.jpg',
    Name: 'Al Madrigal',
    Role: 'Andy',
    SortOrder: '3' } ]       
###
