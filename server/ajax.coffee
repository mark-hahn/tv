
url     = require 'url'
http    = require 'http'
ir      = require './ir'
plex    = require './plex'
roku    = require './roku'
insteon = require './insteon'
log     = require('debug') 'tv:ajax'
port    = require('parent-config')('apps-config.json').tvAjax_port

tvShowsKey = null

# uql = require 'unqlite'
# db = new uql.Database 'plexdb2/plex2.db'
# 
# db.open (err) ->
#   if err then throw err 
#   db.store 'key', JSON.stringify({a:1, b:2}), (err, key, value) ->
#     log {err, key, value}
#     
#   db.fetch 'key', (error, key, value) ->
#     log {error, key, value}

error = (res, msg, code=500) ->
  log 'ajax error: ' +  msg
  if res
    res.writeHead code, 
      'Content-Type': 'text/plain'
      'Access-Control-Allow-Origin': '*'
    res.end JSON.stringify err: msg, status: code

success = (res, data) ->
  if res
    res.writeHead 200, 
      'Content-Type': 'text/json'
      'Access-Control-Allow-Origin': '*'
    result = status: 200
    if data then result.data = data
    res.end JSON.stringify result
  
plex.getSectionKeys (err, keys) ->
  if err then error null, 'getSectionKeys err: ' + err.message; return
  # log 'have SectionKeys', keys
  {tvShowsKey} = keys

poweringUp = no

srvr = http.createServer (req, res) ->
  # log 'ajax http req: ' + req.url
  
  res.writeHead 200, 
    'Content-Type': 'text/json'
    'Access-Control-Allow-Origin': '*'
    
  {pathname, query} = url.parse req.url, true
  data = []
  for q, arg of query
    data[q[1]] = decodeURI arg
  
  switch pathname[1..]
    # when 'favicon'
    #   error res, 'no favicon', 404
      
    when 'log'
      console.log 'tvGlobal.log: ' + data.join ', '
      success res
      
    when 'shows'
      if not tvShowsKey
        error res, 'tvShowsKey missing, ignoring ajax shows req'
        return
      plex.getShowList tvShowsKey, (err, shows) ->
        if err then error res, err.message; return
        result = []
        for show in shows
          {title, summary, thumb} = show
          result.push {title, summary, thumb}
        success res, result

    # for insteon, see ...
    #   /root/Dropbox/apps/hvac/src/commands.coffee
    #   /root/Dropbox/apps/insteon-hub/src/main.coffee
    
    when 'turnOn'
      if poweringUp then success res, 'skipped'; return
      poweringUp = yes
      ir.sendCmd 'pwrOn', (err) ->
        if err then error res, err.message; poweringUp = no; return
        setTimeout ->
          ir.sendCmd 'hdmi2', (err) ->
            poweringUp = no
            if err then error res, err.message; return
            success res, 'done'
        , 15000
        
    when 'irCmd'
      # log 'ajax irCmd', data
      if poweringUp then success res, 'skipped'; return
      ir.sendCmd data..., (err) ->
        if err then error res, err.message; return
        success res, 'sent'

    when 'lightCmd'
      try
        insteon.lightCmd data...
        success res
      catch e
        error res, 'invalid lightCmd URL' + req.url
        
    when 'getLightLevels'
      insteon.getLightLevels (err, lightLevels) ->
        if err then error res, 'getAllLights err: ' + err.message; return
        success res, lightLevels
        
    else
      error res, 'bad request cmd: ' + req.url + ',' + pathname, 400

srvr.listen port
log 'tv ajax listening on port ' + port

###
plex.getSectionKeys (err, keys) ->
  if err then cb? err; return
  log 'getSectionKeys', keys
  {tvShowsKey} = keys
  plex.getShowList tvShowsKey, (err, shows) ->
    if err then cb? err; return
    # log 'shows', shows
    for show, idx in shows when show.type is 'show' and idx is 20
      log 'show', show
      plex.getSeasonList show.key, (err, seasons) ->
        if err then cb? err; return
        season = seasons[0]
        plex.getVideoList season.key, (err, videos) ->
          if err then cb? err; return

  ratingKey: 18483,
  key: '/library/metadata/18483/children',
  studio: 'BBC Four',
  type: 'show',
  title: 'Bob Servant Independent',
  summary: 'Comedy series originating from the bestselling Bob Servant books and the BBC Radio Scotland comedy, The Bob Servant Emails. Bob launches his political campaign with controversial results. A radio appearance leads to a home visit from the police and protests from local dog owners. Bob\'s campaign lies in tatters, but will he make a humbling on-air apology?',
  index: 1,
  rating: '7.0',
  lastViewedAt: 1430007456,
  year: 2013,
  thumb: '/library/metadata/18483/thumb/1430549627',
  art: '/library/metadata/18483/art/1430549627',
  banner: '/library/metadata/18483/banner/1430549627',
  duration: 1800000,
  originallyAvailableAt: '2013-01-23',
  leafCount: 3,
  viewedLeafCount: 3,
  childCount: 1,
  addedAt: 1430549530,
  updatedAt: 1430549627,
  _children: 
   [ { _elementType: 'Genre', tag: 'Comedy' },
     { _elementType: 'Role', tag: 'Brian Cox' },
     { _elementType: 'Role', tag: 'Jonathan Watson' } ] }
###