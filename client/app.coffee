
# src/app

window.appDebug = require 'debug'
appDebug.enable '*'

Vue = require 'vue'
request = require 'superagent'
log = require('debug') 'tv:app'
teacup = require 'teacup'
camelToKebab = require 'teacup-camel-to-kebab'
teacup.use camelToKebab()
{render, meta, title, style, div} = teacup

log 'starting'

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
    }
  """
  
document.body.innerHTML = render ->
  div '#page', ->
    div '#header-comp', vComponent: 'header', vWith: 'curPage: curPage'
    div '#page-comp',   vComponent: '{{curPage}}', keepAlive: ''

#### window resizing ####
htmlEle = document.documentElement
htmlEle.style['font-size'] = fontSize = '48px'
pageEle = document.querySelector '#page'
pageEle.style.width  = (bodyWidInRems = 24) + 'rem'
midRowHeight         =                 '35rem'
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
require './page/header'
require './page/two-btns'
require './show/show-info'
require './show/show-left'
require './show/show-right'
require './show/show-page'
require './episode/episode'
require './watch/watch'
require './lights/lights'

#### ajax ####
serverIp = '192.168.1.103'
ajaxPfx = "http://#{serverIp}:1344/"
ajaxCmd = (cmd, data) ->
  request
    .get ajaxPfx + cmd + (if data then '/' + data else '')
    .set 'Content-Type', 'text/plain'
    .set 'Accept', 'application/json'
    .end (err, res) ->
      if err then log 'ajax cmd get err: ' + err.message; return

#### body view-model ####
new Vue
  el: 'body'
  data:
    curPage: 'lights'
    midRowStyle:  
      height: midRowHeight
  components:
    show:    Vue.component 'show-page'
    episode: Vue.component 'episode-comp'
    watch:   Vue.component 'watch-comp'
    lights:  Vue.component 'lights-comp'
  methods:
    turnOn:  -> ajaxCmd 'turnon'
    turnOff: -> ajaxCmd 'ircmd', 'pwrOff'

