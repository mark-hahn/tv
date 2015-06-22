
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
    #header-comp {
      position: relative;
      top: -0.3rem;
      width: 100%;
      height: 2.5rem;
    }
    #page-comp {
      height: 20rem;
    }
  """
  
require './header'
require './show/show'
require './episode/episode'
require './watch/watch'
require './lights/lights'

new Vue
  el: 'body'
  
  template: render ->
    div '#page', ->
      tag 'header-comp', '#header-comp', 
        curPage: '{{curPage}}'
      tag 'component', '#page-comp', 
        keepAlive:     true
        is:            '{{curPage}}'
        allShows:      '{{allShows}}'
        curShowIdx:    '{{curShowIdx}}'
        curShow:       '{{curShow}}'
        curEpisodeIdx: '{{curEpisodeIdx}}'
        curEpisode:    '{{curEpisode}}'
      
  data:
    curPage:  'show'
    allShows:  []
    curShowIdx: 0
    curShow: {}
    curEpisodeIdx: 0
    curEpisode: {}
    
  components:
    show:     Vue.component 'show-comp'
    episode:  Vue.component 'episode-comp'
    watch:    Vue.component 'watch-comp'
    lights:   Vue.component 'lights-comp'

  created: ->
    @$on 'chgCurPage', (page) ->
      @curPage = page
      if page is 'show' then @$broadcast 'chooseShow'

    @$on 'chgShowIdx', (idx) ->
      @curShowIdx = idx = Math.max 0, Math.min (@allShows.length-1), idx
      @curShow    = show = @allShows[idx]
      @curTags    = show.tags
      epiIdx      = localStorage.getItem 'epiForShow' + show.id
      if epiIdx is 'episodeIdx' then epiIdx = 0 # fix corrupt db
      @$emit 'chgEpisodeIdx', epiIdx ? 0
      localStorage.setItem 'vueCurShowId', show.id
      
    @$on 'chgEpisodeIdx', (idx) ->
      @curEpisodeIdx = idx = Math.max 0, Math.min (@curShow.episodes?.length ? 1) - 1, idx ? 0 
      @curEpisode = @curShow.episodes[idx]
      localStorage.setItem 'epiForShow' + @curShow.id, idx
    
    @$on 'playShow', ->
      firstUnwatched = null
      for episode in @curShow.episodes
        if episode.watched
          if firstUnwatched 
            log 'bad watched structure', firstUnwatched.title, episode.title
            return
          continue
        if not episode.watched and not firstUnwatched
          firstUnwatched = episode
      if firstUnwatched
        log 'starting video', firstUnwatched.title
        tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
        tvGlobal.ajaxCmd 'startVideo', firstUnwatched.key, 0
        return
      log 'all watched'

    tvGlobal.ajaxCmd 'shows', (err, res) => 
      if err then log 'get all shows err', err.message; return
      @allShows = res.data
      document.querySelector('#page').style.visibility = 'visible'
      
  attached: -> 
    tvGlobal.windowResize()
