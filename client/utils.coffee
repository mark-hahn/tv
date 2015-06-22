
log     = require('debug') 'tv:-utils'
Vue     = require 'vue'
request = require 'superagent'

#### app init values ####

window.tvGlobal = {}

#these lines are replaced on every run
serverIp     = '192.168.1.103'
plexServerIp = '192.168.1.103'
ajaxPort     = 2344

ajaxPfx           = "http://#{serverIp}:#{ajaxPort}/"
tvGlobal.plexPfx  = "http://#{plexServerIp}:32400"

tvGlobal.debug = (ajaxPort is 2344)
Vue.config.debug = tvGlobal.debug
require('debug').enable '*'

tvGlobal.windowResize = ->
  htmlEle = document.documentElement
  htmlEle.style['font-size'] = fontSize = '8px'
  pageEle = document.querySelector '#page'
  pageEle.style.width  = (bodyWidInRems = 24  ) + 'rem'
  pageEle.style.height = (bodyHgtInRems = 40.5) + 'rem'
  resizeTimeout = null
  do resize = ->
    newFontSize = 0.95 * (
      Math.min window.innerWidth  / bodyWidInRems,
               window.innerHeight / bodyHgtInRems
    ) + 'px'
    if newFontSize isnt fontSize
      fontSize = newFontSize
      # document.body.style.height = (window.outerHeight + 50) + 'px'
      if resizeTimeout then clearTimeout resizeTimeout
      resizeTimeout = setTimeout ->
        htmlEle.style['font-size'] = fontSize
        resizeTimeout = null
        # window.scrollTo 0, 1
      , 75
  window.addEventListener 'resize', resize

tvGlobal.ensureVisible = (outerSel, sel) ->
  setTimeout ->
    if (outerEle = document.querySelector outerSel) and
       (ele      = document.querySelector sel)
      {top: outerTop, bottom: outerBottom} = outerEle.getBoundingClientRect()
      {top, bottom} = ele.getBoundingClientRect()
      if not (outerTop < top    < outerBottom and
              outerTop < bottom < outerBottom)
        ele.scrollIntoView()
  , 2000

tvGlobal.ajaxCmd = (cmd, args..., cb) ->
  if cb and typeof cb isnt 'function' then args.push cb
  query = ''
  sep = '?'
  for arg, idx in args when arg?
    query += sep + 'q' + idx + '=' +arg.toString()
    sep = '&'
  request
    .get ajaxPfx + cmd + query
    .set 'Content-Type', 'text/plain'
    .end (err, res) ->
      if err or res.status isnt 200
        log 'ajax err', (err ? res.status); cb? err ? res; return
      cb? null, JSON.parse res.text

tvGlobal.ajaxLog = (args...) ->
  msg = args.join ', '
  console.log 'tvGlobal.log: ' + msg
  tvGlobal.ajaxCmd 'log', msg

tvGlobal.tagList = [
  'Foreign', 'Comedy', 'Drama', 'Crime', 'MarkOnly', 'LindaOnly'     
  'Favorite', 'OnTheFence', 'New', 'Watched', 'Archive', 'Deleted' 
]      

tvGlobal.syncPlexDB = -> tvGlobal.ajaxCmd 'syncPlexDB'
