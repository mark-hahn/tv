
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
 btn.playCtl {
   font-weight: bold;
 }
"""

Vue.component 'watch-info-comp', 
  props: ['show', 'episode', 'videoFile', 'watchMode', 'getPlayPos', 'chkVidInit']
  
  template: render ->
    div '.watch-info', ->
      img '.show-banner', vAttr: 'src: bannerUrl'
      div '.watch-episode-title', 
            '{{episode.episodeNumber + ": " + episode.title}}'
      div '.web-video-blk', vIf: 'episode',->
        video '.video', 
          vAttr:'src: videoUrl'
          autoplay:yes
          preload:'auto'
          vOn:'click:chkVidInit, playing: vidPlay'
        div '.web-video-ctrls', ->
          div '.ctrl-row.web-video-ctrls', ->
            div '.btn.playCtl', vOn: 'click: vidCtrlClk', '<<'
            div '.btn.playCtl', vOn: 'click: vidCtrlClk', '{{vidPlayPauseTxt}}'
            div '.btn.playCtl', vOn: 'click: vidCtrlClk', '>>'
          div '.ctrl-row.web-video.bookmarks', ->
            div '.btn', vOn: 'click: vidCtrlClk', 'Prev'
            div '.btn', vOn: 'click: vidCtrlClk', 'Mark'
            div '.btn', vOn: 'click: vidCtrlClk', 'Next'
            
  data: ->
    bigVideo: no
    videoUrl: ''
    vidPlayPauseTxt: ''
    videoState: 'none'
    
  methods:
    vidPlay: -> @vidHasPlayed = yes
      
    vidCtrlClk: ->
      
  computed:
    bannerUrl: -> tvGlobal.plexPfx + @show.banner
    
    videoUrl: -> 
      if @bigVideo
        pfx = '/mnt/media/videos/' 
        sfx = ''
      else 
        pfx = '/mnt/media/videos-small/'
        sfx = '.mp4'
      videoUrl = tvGlobal.vidSrvrPfx + pfx + encodeURIComponent(@videoFile) + sfx
      log 'computed videoUrl', videoUrl
      @videoState = 'loaded'
      videoUrl
      
    vidPlayPauseTxt: ->
      switch @watchMode
        when 'paused' then '>'
        else '||'

  events:
    videoEnable: ->
      switch @videoState 
        when 'none'
          setTimeout (=> @videoEnable()), 100
        when 'loaded'
          @$emit 'videoCmd', 'play'
          @videoState = 'enabled'
          
    videoCmd: (cmd, playPos) ->
      if not @videoEle then return
      switch cmd
        when 'playPos'
          @videoEle.play()
          if Math.abs(@videoEle.currentTime - playPos) > 0.2
            @videoEle.currentTime = playPos
        when 'play'
          @videoEle.muted = yes
          @videoEle.play()

        when 'pause' then @videoEle.pause()
        when 'stop'  then @videoEle.src = ''
          
    setPlayState: (state) ->
      if state is 'playing' then @$emit 'videoCmd', 'play'
      if state is 'paused'  then @$emit 'videoCmd', 'pause'

  attached: -> 
    @chkVidInit = (e) =>
      if not @vidHasPlayed then @$emit 'videoCmd', 'play'; yes
      else 
        if e then @$dispatch 'tvBtnClick', 'togglePlay'
        no

    @videoEle = @$el.querySelector 'video'
    
    @videoEle.addEventListener 'error', (args...) =>
      @$dispatch 'popup', 'Using big video'
      @bigVideo = yes
    
    @getPlayPos = => @videoEle.currentTime 
    
