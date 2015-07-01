###
  src/plex.coffee
###

util      = require 'util'
path      = require 'path'
fs        = require 'fs-plus'
request   = require 'request'
log       = require('debug') 'tv:plex'
moment    = require 'moment'
ffmpeg    = require 'fluent-ffmpeg'

{CHROOT, USER, HOME_IP, AT_HOME, SERVER_IP, SERVER_HOST, DEBUG, LOCATION, OFF_SITE} = process.env

plexServerIp   = SERVER_HOST
plexServerPort = (if OFF_SITE isnt 'false' then '17179' else '32400')
plexPfx  = "http://#{plexServerIp}:#{plexServerPort}"

getPlexData = (path, eleType, cb) ->
  if SERVER_HOST is 'localhost' then cb null, []; return;
   
  opts =
    url: "#{plexPfx}#{path}"
    headers: Accept: 'application/json'
  request opts, (err, resp, body) ->
    # log {err, resp, body}
    if err or resp.statusCode isnt 200
      log 'getPlexData req error:', opts, resp.statusCode, util.inspect err, depth:null
      cb? err
      return
    libResponse = JSON.parse body
    data = []
    for child in libResponse._children when not eleType or child._elementType is eleType
      data.push child
    cb? null, data
    
exports.findRoku = (rokuName, cb) ->
  getPlexData '/clients', 'Server', (err, clients) ->
    if err then cb err; return
    for client in clients when client.name is rokuName
      cb null, client, plexServerIp, plexServerPort
      return
    log 'findRoku, roku client not found:', clients
    cb? message: 'roku client not found'
    
exports.getSectionKeys = (cb) ->
  getPlexData '/library/sections', 'Directory', (err, data) ->
    if err then cb err; return
    for dir in data
      switch dir.title
        when 'TV Shows' then tvShowsKey = dir.key
        when 'Movies'   then moviesKey  = dir.key
        else continue
    if not tvShowsKey or not moviesKey
      log 'getSectionKeys, key missing', data
      cb message: 'key missing'
      return
    cb null, {tvShowsKey, moviesKey}

shrinkOneVideo = (src, dst, cb) ->
  ffmpeg(timeout: 20*60e3, niceness: 20)
    .input src
    .videoCodec 'libx264'
    .videoBitrate 64
    .size '320x240'
    .audioCodec 'libmp3lame'
    .audioQuality 0
    .withAudioChannels 1
    .withAudioBitrate 16
    .addOption '-sn'
    .on 'end', cb
    .save dst
    
do oneShrink = ->
  log 'oneShrink'
  allProcPaths = fs.listTreeSync '/mnt/media/videos-processing'
  for procPath in allProcPaths
    fs.removeSync procPath.replace '/videos-processing/', '/videos-small/'
    fs.removeSync procPath
  allPaths = fs.listTreeSync '/mnt/media/videos'
  for path, idx in allPaths 
    if fs.isDirectorySync path
      log 'skipping directory', path
      continue
    shrunkPath = (path.replace '/videos/', '/videos-small/') + '.mkv'
    if not fs.existsSync shrunkPath
      log '===>', idx+1, 'of', allPaths.length, '-->' + path
      procPath =  shrunkPath.replace '/videos-small/', '/videos-processing/'
      fs.writeFileSync procPath, ''
      shrinkOneVideo path, shrunkPath, ->
        fs.removeSync procPath
        oneShrink()
      return
  log 'all files shrunk, waiting 5 mins'
  setTimeout oneShrink, 300e3
        
reqShowListTO = null
inGetShowList = no

exports.getShowList = getList = (key, cb) ->
  if AT_HOME isnt 'true' then cb null; return;
  
  if reqShowListTO then clearTimeout reqShowListTO
  
  if inGetShowList
    reqShowListTO = setTimeout (-> getList key, cb), 1000
    return
  
  inGetShowList = yes
  
  getPlexData "/library/sections/#{key}/all", 'Directory', (err, shows) ->
    if err then cb err; return
    result = []
    
    do oneShow = ->
      if not (show = shows.shift())
        cb null, result
        inGetShowList = no
        return

      {key, title, summary, thumb, year, duration, leafCount, viewedLeafCount, type, banner} = show
        
      id = key.split('/')[3]
      tags = {}
      for child in show._children ? []
        if child._elementType is 'Genre' then tags[child.tag] = yes
      duration = +duration
      
      result.push resShow = {id, title, summary, thumb, year, duration, tags, type, banner}
                             
      getPlexData key, 'Directory', (err, seasons) ->
        if err then cb err; return
        resShow.episodes = []
        
        do oneSeason = ->
          if not (season = seasons.shift())
            oneShow()
            return
          if season.type isnt 'season' then oneSeason(); return
          
          getPlexData season.key, 'Video', (err, episodes) ->
            if err then cb err; return
            
            for episode in episodes when episode.type is 'episode'
              {index, title, summary, thumb, viewCount, key, duration,  \
               originallyAvailableAt, type} = episode

              id = key.split('/')[3]
              episodeNumber = season.index + '-' + index
              aired = moment(originallyAvailableAt).format('M/D/YY')
              episodeLen = duration / 1000
              viewCount ?= 0
              viewCount = +viewCount
              
              resShow.episodes.push {
                id, showId: resShow.id, episodeNumber, title, summary, \
                thumb, viewCount, key, episodeLen, aired, type 
              }
            oneSeason()

exports.getStatus = (cb) ->
  getPlexData '/status/sessions', 'Video', (err, sessions) ->
    if err then cb err; return
    for session, sidx in (sessions ? []) when session?._elementType is 'Video'
      for player, pidx in session._children when player._elementType is 'Player'
        if player.title is 'Roku 3'
          for media in session._children when media._elementType is 'Media'
            for part in media._children when part._elementType is 'Part'
              # log 'session:' + sidx, 'player:' + pidx, session.grandparentTitle, 
                  #  session.viewOffset, player.title, player.state, part.key
              cb null,
                id:        session.key.split('/')[3]
                videoKey:  part.key
                playPos:   (+session.viewOffset + 400) / 1000
                playState: player.state
              return
    cb()

