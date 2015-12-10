###
  utils.coffee 
###

log     = require('debug') 'tv:-utils'
Vue     = require 'vue'

window.tvGlobal = {}

# config vars from server
# this line is replaced on every run
serverConfigStr = '{"CHROOT":"","USER":"root","HOME_IP":"108.38.125.245","AT_HOME":"true","SERVER_IP":"192.168.1.103","SERVER_HOST":"192.168.1.103","DEBUG":"*","LOCATION":"server","OFF_SITE":"false"}'
tvGlobal.serverConfig = JSON.parse serverConfigStr
# log 'serverConfig', tvGlobal.serverConfig

require('debug').enable tvGlobal.serverConfig.DEBUG
Vue.config.debug = tvGlobal.debug = (tvGlobal.serverConfig.DEBUG is '*')

tvGlobal.windowResize = (cb) ->
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
        resizeTimeout = null
        htmlEle.style['font-size'] = fontSize
        cb()
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

tvGlobal.tagList = [
  'Foreign', 'Comedy', 'Drama', 'MarkOnly', 'MarkFavs', 'LindaOnly'     
  'LindaFavs', 'OnTheFence', 'New', 'LessThan3', 'Watched', 'Archive', 'Deleted' 
]      

tvGlobal.syncPlexDB = -> # tvGlobal.ajaxCmd 'syncPlexDB'
