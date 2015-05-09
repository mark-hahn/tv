
# src/app

Vue = require 'vue'
teacup = require 'teacup'
camelToKebab = require 'teacup-camel-to-kebab'
teacup.use camelToKebab()

{render, meta, title, style, div} = teacup


#### intial html ####

document.head.innerHTML = render ->
  meta
    name: 'viewport'
    content: 'width=device-width, initial-scale=1, user-scalable=no'
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
      user-select: none;
    }
    #page-outer {
      overflow: hidden; 
      position: relative;
      margin: 0.3rem;
    }
  """
  
document.body.innerHTML = render ->
  div '#page-outer', ->
    div vComponent: 'header-comp', vWith: 'curPage: curPage'
    div vComponent: '{{curPage}}', keepAlive: ''


#### window resizing ####

htmlEle = document.documentElement
htmlEle.style['font-size'] = fontSize = '48px'
pageEle = document.querySelector '#page-outer'
pageEle.style.width  = (bodyWidInRems = 24) + 'rem'
pageEle.style.height = (bodyHgtInRems = 38) + 'rem'
resizeTimeout = null
  
do resize = ->
  newFontSize = 0.95 * (
    Math.min window.innerWidth  / bodyWidInRems,
             window.innerHeight / bodyHgtInRems
  ) + 'px'
  if newFontSize isnt fontSize
    fontSize = newFontSize
    if resizeTimeout
      clearTimeout resizeTimeout
    resizeTimeout = setTimeout ->
      htmlEle.style['font-size'] = fontSize
      resizeTimeout = null
    , 75

window.addEventListener 'resize', resize


#### page components ####

require './header'
require './show'
require './episode'
require './watch'
require './lights'


#### body view-model ####

new Vue
  el: 'body'
  data:
    curPage: 'show'
  components:
    show:    Vue.component 'show-comp'
    episode: Vue.component 'episode-comp'
    watch:   Vue.component 'watch-comp'
    lights:  Vue.component 'lights-comp'
    
