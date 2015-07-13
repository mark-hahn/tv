
# src/app

util    = require 'util'
log     = require('debug') 'tv:---app'
Vue     = require 'vue'

require './utils'
Vue.use require 'vue-keep-scroll'
teacup = require 'teacup'
camelToKebab = require 'teacup-camel-to-kebab'
teacup.use camelToKebab()

{render, tag, meta, title, style, div} = teacup

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
      font-size: 8px;
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
      visibility: hidden;
      position: relative;
      margin: 0.3rem;
    }
    header-comp {
      position: relative;
      top: -0.3rem;
      width: 100%;
      height: 2.5rem;
    }
    #page-comp {
      position: relative;
      height: 20rem;
    }
    #popup {
      position: absolute;
      left: 3.3rem;
      top: 30rem;
      width: 20rem;
      height: 2rem;
      background-color: white;
      border: 1px solid black;
      text-align: center;
      border-radius: 0.5rem;
      font-size: 1.4rem;
      line-height: 1.3;
    }
"""
  
require './header'
require './show/show'
require './episode/episode'
require './watch/watch'
require './lights/lights'

new Vue
  el: 'body'
  replace: false
  
  template: render ->
    div '#page', ->
      tag 'header-comp', 
        curPage:       '{{curPage}}'
      
      tag 'show-comp',   
        vShow:         'curPage == "show"',
        allShows:      '{{allShows}}'
        curShowIdx:    '{{curShowIdx}}'
        curShow:       '{{curShow}}'
        
      tag 'episode-comp', 
        vShow:         'curPage == "episode"',
        curShow:       '{{curShow}}'
        curEpisodeIdx: '{{curEpisodeIdx}}'
        curEpisode:    '{{curEpisode}}'
        
      tag 'watch-comp',   
        vShow:         'curPage == "watch"',
        allShows:      '{{allShows}}'
        
      tag 'lights-comp',  
        vShow:         'curPage == "lights"'
        
    div '#popup', vIf:'popupMsg', '{{popupMsg}}'
      
  data:
    curPage:      'show'
    allShows:      []
    curShowIdx:    0
    curShow:       {}
    curEpisodeIdx: 0
    curEpisode:    {}
    popupMsg:      ''
    
  created: ->
    tvGlobal.ajaxCmd 'shows', (err, res) => 
      if err then log 'get all shows err', err.message; return
      @allShows = res.data
      document.querySelector('#page').style.visibility = 'visible'
      
    tvGlobal.syncPlexDB()

  events:
    chgCurPage: (page) ->
      @curPage = page
      if page is 'show' then @$broadcast 'chooseShow'

    chgShowIdx: (idx) ->
      @curShowIdx = idx = Math.max 0, Math.min (@allShows.length-1), idx
      @curShow    = show = @allShows[idx]
      @curTags    = show.tags
      epiIdx      = localStorage.getItem 'epiForShow' + show.id
      if epiIdx is 'episodeIdx' then epiIdx = 0 # fix corrupt db
      @$emit 'chgEpisodeIdx', epiIdx ? 0
      localStorage.setItem 'vueCurShowId', show.id
       
    chgEpisodeIdx: (idx) ->
      @curEpisodeIdx = idx = Math.max 0, Math.min (@curShow.episodes?.length ? 1) - 1, idx ? 0 
      @curEpisode = @curShow.episodes[idx]
      localStorage.setItem 'epiForShow' + @curShow.id, idx
    
    startWatch: (episode = @curEpisode) ->
      @$emit 'chgCurPage', 'watch'
      @$broadcast 'startWatch', episode
      
    popup: (msg) -> 
      @popupMsg = msg
      if @popupTO then clearTimeout @popupTO
      @popupTO = setTimeout (=> @popupMsg = ''), 4000
      
  attached: -> 
    tvGlobal.windowResize => @$broadcast 'resize'
    @$el.addEventListener 'click', => @popupMsg = ''

