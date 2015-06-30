
Vue = require 'vue'
log = require('debug') 'tv:wchnfo'

{render, tag, div, img, video} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
 .watch-info {
   width:100%;
 }
.show-banner {
   width:98%
 }
 .watch-episode-title {
  text-align: center;
  font-size: 1.4rem; 
  max-width: 98%;
  margin-top:0.5rem;
 }
 .watch-info .web-video-blk {
   background-color: #eec;
   border-left:   1px solid gray;
   border-top:    1px solid gray;
   border-bottom: 1px solid gray;
   margin-top:0.5rem;
   padding-bottom:4px;
   width:100%;
 }
 .watch-info video {
   width:98%;
   margin:1%
 }
 .watch-info .ctrl-row {
   margin-top: 2%;
   display: block;
   height: 33%;
 }
 .watch-info .ctrl-row .btn {
   font-size:2rem;
   width: 33%;
   height: 3rem;
 }
"""

Vue.component 'watch-info-comp', 
  props: ['show', 'episode', 'video-key', 'play-pos', 'play-state', 'web-video-mode']
  
  template: render ->
    div '.watch-info', vIf: 'episode !== null', ->
      img '.show-banner', vAttr: 'src: bannerUrl'
      div '.watch-episode-title', 
            '{{episode.episodeNumber + ": " + episode.title}}'
      div '.web-video-blk', ->
        video '.video', 
          vAttr:'src: videoUrl'
          autoplay:yes
          preload:'auto'
          vOn:'click:onClick'
        div '.web-video-ctrls', ->
          div '.ctrl-row.web-video-ctrls', ->
            div '.btn', vOn: 'click: vidCtrlClk', '<<'
            div '.btn', vOn: 'click: vidCtrlClk', '{{vidPlayPauseTxt}}'
            div '.btn', vOn: 'click: vidCtrlClk', '>>'
          div '.ctrl-row.web-video.bookmarks', ->
            div '.btn', vOn: 'click: vidCtrlClk', 'Prev'
            div '.btn', vOn: 'click: vidCtrlClk', 'Mark'
            div '.btn', vOn: 'click: vidCtrlClk', 'Next'

  computed:
    bannerUrl: -> tvGlobal.plexPfx + @show.banner
    videoUrl:  -> tvGlobal.plexPfx + @videoKey
    vidPlayPauseTxt: ->
      switch @webVideoMode
        when 'paused' then '>'
        else '| |'
            
  methods:
    vidCtrlClk: ->
      
    onClick: ->
      log 'onClick'
      tvGlobal.ajaxCmd 'playPauseVideo'
      if @playState is 'playing'
        @videoEle?.play()
      else 
        @videoEle?.pause()
        tvGlobal.ajaxCmd 'startVideo', @videoEle.currentTime
        
    setPlayState: ->
      if @videoEle
        @videoEle.currentTime = @playPos
        # switch @playState
        #   when 'playing' then @videoEle?.play()
        #   else @videoEle?.pause()
      
  watch:
    playPos:   -> @setPlayState()
    playState: -> @setPlayState()
      
  attached: -> 
    intervalTO = setInterval => 
      if not (@videoEle = @$el.querySelector 'video') then return 
      if intervalTO then clearInterval intervalTO
      setTimeout (=> @setPlayState()), 500
    , 300
    
  detached: ->
    @videoEle?.pause()
