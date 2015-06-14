
Vue = require 'vue'
log = require('debug') 'tv:wch'

Vue.component 'watch-comp', 
  template: "I'm the WATCH page"
  
# setInterval ->
#   tvGlobal.ajaxCmd 'getPlayStatus', (err, playStatus) ->
#     log 'playStatus', err, playStatus.data
# , 2000
# 
