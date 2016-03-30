###
  utils.coffee 
###

log     = require('./debug') '-utils'
Vue     = require 'vue'

# config vars from server
# this line is replaced on every run
serverConfigStr = '{"CHROOT":"","USER":"root","HOME_IP":"173.58.39.204","AT_HOME":"true","DEBUG":"*","LOCATION":"server","OFF_SITE":"false"}'
tvGlobal.serverConfig = JSON.parse serverConfigStr
# log 'serverConfig', tvGlobal.serverConfig

Vue.config.debug = tvGlobal.debug

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
  'LindaFavs', 'OnTheFence', 'New', 'LessThan3', 'Kids', 'Watched', 'Archive', 'Deleted' 
]      

tvGlobal.syncPlexDB = -> # tvGlobal.ajaxCmd 'syncPlexDB'
