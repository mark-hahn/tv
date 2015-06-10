
# src/app

Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:app---'

Vue.config.debug = yes

serverIp = '192.168.1.103'
window.tvGlobal = {}
#this line is replaced on every run
tvGlobal.ajaxPort = 2344
debug = (tvGlobal.ajaxPort is 2344)
ajaxPfx = "http://#{serverIp}:#{tvGlobal.ajaxPort}/"
require('debug').enable '*'

teacup = require 'teacup'
camelToKebab = require 'teacup-camel-to-kebab'
teacup.use camelToKebab()
{render, tag, meta, title, style, div} = teacup

#### intial html ####

document.head.innerHTML = render ->
  meta name: 'viewport', \
    content: 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, ' +
             'user-scalable=no'
  title 'Hahn TV'
  style """
    html { 
      box-sizing: border-box; 
    }
    *, *:before, *:after { 
      box-sizing: inherit; 
    }
    html, body { 
      overflow: hidden; 
      background-color: #ddd;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      -khtml-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
    }
    .btn {
      display: inline-block;
      border: 2px solid #ddd; 
      background-color: #ccc;
      text-align: center;
      font-size: 1.4rem;
      cursor: pointer;
      border-radius: 0.6rem;
    }
    .btn.selected {
      background-color: #ee8; 
    }
    #page {
      position: relative;
      margin: 0.3rem;
    }
    #header-comp {
      position: relative;
      top: -0.3rem;
      width: 100%;
      height: 2.5rem;
    }
    #page-comp {
      height: 34rem;
    }
    [v-cloak] { 
      display: none;
    }
  """

document.body.innerHTML = render ->
  div '#page', vCloak:'', ->
    
    tag 'header-comp', '#header-comp', curPage:'curPage'
      
    tag 'component', '#page-comp',   
      is:         '{{curPage}}', 
      keepAlive:  ''
      curShowIdx: '{{curShowIdx}}'
      allShows:   '{{allShows}}'

#### window resizing ####

document.body.style.fontSize = '8px'
htmlEle = document.documentElement
htmlEle.style['font-size'] = fontSize = '48px'
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

#### page components ####

require './header'
require './show/show'
require './episode/episode'
require './watch/watch'
require './lights/lights'

#### ajax ####

tvGlobal.ajaxCmd = (cmd, args..., cb) ->
  if typeof cb isnt 'function' then args.push cb
  query = ''
  sep = '?'
  for arg, idx in args when arg
    query += sep + 'q' + idx + '=' +arg.toString()
    sep = '&'
  request
    .get ajaxPfx + cmd + query
    .set 'Content-Type', 'text/plain'
    .end (err, res) ->
      # console.log 'ajaxCmd ret', {cmd, args, err, res}
      if err or res.status isnt 200
        log 'ajax err', (err ? res.status); cb? err ? res; return
      cb? null, JSON.parse res.text

tvGlobal.ajaxLog = (args...) ->
  msg = args.join ', '
  console.log 'tvGlobal.log: ' + msg
  tvGlobal.ajaxCmd 'log', msg
  
#### body view-model ####

new Vue
  el: 'body'
  
  data:
    curPage:   (if not debug then 'lights' else 'show')
    allShows: []
    curShowIdx: 10
    
  components:
    show:    Vue.component 'show-comp'
    episode: Vue.component 'episode-comp'
    watch:   Vue.component 'watch-comp'
    lights:  Vue.component 'lights-comp'
    
  created: ->
    request
      .get ajaxPfx + 'shows'
      .set 'Content-Type', 'text/plain'
      .set 'Accept', 'application/json'
      .end (err, res) =>
        if err then log 'allShows ajax err: ' + err.message; return
        @allShows = JSON.parse(res.text).data
        
