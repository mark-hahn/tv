
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
      margin:0; 
      font-size: 48px; 
      background-color: #ddd;
    }  
  """
  
document.body.innerHTML = render ->
  div vComponent: 'header-comp'
  div vComponent: '{{curPage}}', keepAlive: ''


#### page components ####

require './header'
require './show'
require './episode'
require './watch'
require './lights'


#### body/page view/model ####

page = new Vue
  el: 'body'
  data:
    curPage: 'show'
  components:
    show:    Vue.component 'show-comp'
    episode: Vue.component 'episode-comp'
    watch:   Vue.component 'watch-comp'
    lights:  Vue.component 'lights-comp'
    
