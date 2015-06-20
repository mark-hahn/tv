
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

#### doc header ####

document.head.innerHTML = render ->
  meta name: 'viewport', \
    content: 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, ' +
             'user-scalable=no'
  title 'Hahn TV'
  
#### page styles ####

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
    [v-cloak] { 
      display: none;
    }
  """


#### page components ####

require './header'
require './show/show'
require './episode/episode'
require './watch/watch'
require './lights/lights'

#### body view-model ####

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
    curPage: (if tvGlobal.debug then 'show' else 'show')
    allShows:  []
    curShowIdx: 0
    curShow: {}
    curEpisodeIdx: 0
    curEpisode: {}
    
  watch:
    curShowIdx: (idx) -> 
      @curShow = show = @allShows[idx]
      @curTags = show.tags
      
    curEpisodeIdx: (idx) -> @curEpisode = @curShow.episodes[idx] ? 0
      
  #     get: -> Math.max 0, 
  #             Math.min (@curShow.episodes?.length ? 1) - 1, @curShow.episodeIdx ? 0
  #     set: (idx) -> 
  #       @curShow.episodeIdx = 
  #         Math.max 0, Math.min (@curShow.episodes?.length ? 1) - 1, idx ? 0
  #       @curShow.episodeIdx = idx
  # computed: 
  #   # curShow: -> @allShows[@curShowIdx] ? {}
  #   curEpisode: -> @curShow.episodes?[@curEpisodeIdx] ? {}
  
  components:
    show:    Vue.component 'show-comp'
    episode: Vue.component 'episode-comp'
    watch:   Vue.component 'watch-comp'
    lights:  Vue.component 'lights-comp'
    
  created: ->
    @$on 'chgCurPage', (page) -> 
      @curPage = page
      @curEpisodeIdx = localStorage.getItem('epiForShow' + @curShow.id) ? 
                       @curShow.episodeIdx ? 0

    @$on 'chgShowIdx', (idx) ->
      @curShowIdx = Math.max 0, Math.min (@allShows.length-1), idx
      localStorage.setItem 'vueCurShowId', @allShows[idx]?.id
      
    @$on 'chgEpisodeIdx', (idx) ->
      @curEpisodeIdx = idx
      tvGlobal.ajaxCmd 'setDBField', @curShow.id, 'episodeIdx', idx
      localStorage.setItem 'epiForShow' + @curShow.id, idx
    
    tvGlobal.ajaxCmd 'shows', (err, res) => 
      if err then log 'get all shows err', err.message; return
      @allShows = res.data
      
  attached: -> tvGlobal.windowResize()
