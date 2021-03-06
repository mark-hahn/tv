###
  app.coffee 
###

log  = require('./debug') '---app'
util = require 'util'
exec = require('child_process').exec
Vue  = require 'vue'
FuzzySet = require 'fuzzyset.js'

tvGlobal = window.tvGlobal = {}
tvGlobal.base = location.pathname.replace /\//g, ''
tvGlobal.debug = (tvGlobal.base is 'tvd')

require './utils'
require './ajax-client'

if tvGlobal.debug then require './live'

Vue.use require 'vue-keep-scroll'
teacup = require 'teacup'
camelToKebab = require 'teacup-camel-to-kebab'
teacup.use camelToKebab()

{render, tag, meta, title, base, style, div, script} = teacup

document.head.innerHTML = render ->
  meta name: 'viewport', \
    content: 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, ' +
             'user-scalable=no'
  title 'Hahn TV'
  base href:"http://hahnca.com/#{tvGlobal.base}/"
  
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
      left:0.5rem;
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
      z-index: 100;
      display: none;
    }
    #popup.popupVisible {
      display: block;
    }
"""

do init = ->
  log 'do init'
  require './header'
  require './show/show'
  require './episode/episode'
  require './watch/watch'
  require './record/record'
    
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
          
        tag 'record-comp',  
          vShow: 'curPage == "record"'
          
        tag 'watch-comp',   
          vShow:         'curPage == "watch"',
          allShows:      '{{allShows}}'
          
      div '#popup', vClass: 'popupVisible: popupMsg != ""', '{{popupMsg}}'
      
      script "function getip(json) { alert(json.ip) }"
      # script src:'http://www.telize.com/jsonip?callback=getip'        
        
    data: 
      curPage:      'show'
      allShows:      []
      curShowIdx:    0
      curShow:       {}
      curEpisodeIdx: 0
      curEpisode:    {}
      popupMsg:      ''
       
    events:
      videoEnable: ->
        @$broadcast 'videoEnable'
      
      chgCurPage: (page) ->
        @curPage = page
        if page is 'show' then @$broadcast 'chooseShow'

      chgShowIdx: (idx) ->
        @curShowIdx = idx = Math.max 0, Math.min (@allShows.length-1), idx
        @curShow    = show = @allShows[idx]
        @curTags    = show.tags
        epiIdx      = sessionStorage.getItem 'epiForShow' + show.id
        @$emit 'chgEpisodeIdx', epiIdx
        localStorage.setItem 'vueCurShowId', show.id
        
      chgEpisodeIdx: (idx, cb) ->
        tvGlobal.ajaxCmd 'episodes', @curShow.id, (err, res) => 
          if err then log 'get episodes err', err.message; return
          {watchedCount, availCount, episodes} = res.data
          tags = @curShow.tags
          if watchedCount is 0 then tags.New = yes
          else delete tags.New
          if availCount < 3 then tags.LessThan3 = yes
          else delete tags.LessThan3
          if watchedCount is availCount then tags.Watched = yes
          else delete tags.Watched
          @curShow.episodes = episodes
          @curEpisodeIdx = idx = 
            Math.max 0, Math.min (@curShow.episodes?.length ? 1) - 1, idx
          @curEpisode = @curShow.episodes[idx]
          # log '@curEpisode', @curEpisode.title, idx, '/', @curShow.episodes.length
          sessionStorage.setItem 'epiForShow' + @curShow.id, idx
      
      startWatch: (episode = @curEpisode) ->
        @$emit 'chgCurPage', 'watch'
        @$broadcast 'startWatch', @curShow.title, episode
        
      stopWatch: -> @$broadcast 'stopWatch'
        
      tvTurningOff: -> @$broadcast 'tvTurningOff'
        
      popup: (msg) -> 
        log 'popup', msg
        @popupMsg = msg
        if @popupTO then clearTimeout @popupTO
        @popupTO = setTimeout (=> @popupMsg = ''), 3000
        
    created: ->
      log 'loading all'
      tvGlobal.ajaxCmd 'shows', (err, res) => 
        if err then log 'get all shows err', err.message; return
        @allShows = res.data
        log 'all shows loaded', @allShows.length
        document.querySelector('#page').style.visibility = 'visible'
        
    attached: -> 
      tvGlobal.windowResize => @$broadcast 'resize'
      @$el.addEventListener 'click', => @popupMsg = ''
      
      document.body.addEventListener 'keypress', (e) =>
        # log 'key', e.charCode
        switch e.charCode 
          
          when 98 # b   open in btn
            window.open 'https://broadcasthe.net/torrents.php?searchstr=' +
                         encodeURI(@curShow.title), 'GoToShow'
            
          when 99 # c   show matching config.yml
            title = @curShow.title
            title = title.replace(/[^a-z\s&`]/ig, '')
            title = title.replace(/^\s+/ig, '')
            title = title.replace(/\s+$/ig, '')
            title = title.replace(/\s*\bUS\b\s*$/ig, '')
            console.log '---'
            console.log '---', title, '---'
            tvGlobal.ajaxCmd 'usbconfig', (err, res) =>
              fuzz = FuzzySet res.data
              if (matches = fuzz.get title) and matches.length
                matches.sort (a,b) -> a[1] < b[1]
                for m in matches # when m[0] > .75
                  console.log m[0].toFixed(2), m[1]
              else
                console.log title + 'no match'
              console.log '---'
              # alert fuzz.get(title).join ', '
        
          when 110  # n    next show
            @$emit 'chgShowIdx', @curShowIdx + 1
            
          when 112  # p    prev show
            @$emit 'chgShowIdx', @curShowIdx - 1
            
          when 119  # w    toggle watched
            @$broadcast 'twoBtnClk', 'Watched'
            
          when 117  # u    click up
            @$broadcast 'twoBtnClk', 'Up'
            
          when 100  # d    click down
            @$broadcast 'twoBtnClk', 'Down'
            
          when 101, 103    
            query = encodeURI @curShow.title + ' ' +
              switch e.charCode 
                when 103 then 'tv show' # s
                when 101 then 'tv show episode list guide' # e
            window.open "https://www.google.com/search?q=#{query}",'auxtvwin'
            
          else log 'invalid key:', e.charCode
            
      showIdx = 0
      do oneShow = => 
        if not @allShows?.length
          setTimeout oneShow, 200
          return
        if not (show = @allShows[showIdx++]) 
          log 'all episodes loaded'
          return
        if show.episodes.length
          setTimeout oneShow, 0
          return
        tvGlobal.ajaxCmd 'episodes', show.id, (err, res) => 
          if err then log 'get episodes err', err.message; return
          {watchedCount, availCount, episodes} = res.data
          tags = show.tags
          if watchedCount is 0 then tags.New = yes
          else delete tags.New
          if availCount < 3 then tags.LessThan3 = yes
          else delete tags.LessThan3
          if watchedCount is availCount then tags.Watched = yes
          else delete tags.Watched
          show.episodes = episodes
          oneShow()
