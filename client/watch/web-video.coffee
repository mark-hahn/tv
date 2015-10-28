###
  web-video.coffee
###

log = require('debug') 'tv:wchnfo'
Vue = require 'vue'
  
{render, tag, div, img, video} = require 'teacup'

vidPosOfsPlay = -1
vidPosOfsFwd  =  25
vidPosOfsBack = -10  
 
(document.head.appendChild document.createElement('style')).textContent = """
 .watch-video {
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
 .watch-video .web-video-blk {
   background-color: #eec;
   border-left:   1px solid gray;
   border-top:    1px solid gray;
   border-bottom: 1px solid gray;
   margin-top:0.5rem;
   padding-bottom:4px;
   width:100%;
 }
 .watch-video video {
   width:98%;
   margin:1%
 }
 .watch-video .ctrl-row {
   margin-top: 2%;
   display: block;
   height: 33%;
 }
 .watch-video .ctrl-row .btn {
   font-size:2rem;
   width: 33%;
   height: 3rem;
 }
 btn.playCtl {
   font-weight: bold;
 }
"""

Vue.component 'watch-video-comp', 
  props: ['show', 'episode', 'videoFile', 'watchMode', 'getPlayPos', 'chkVidInit']
  
  template: render ->
    div '.watch-video', ->
      img '.show-banner', vAttr: 'src: bannerUrl'
      div '.watch-episode-title', 
            '{{episode.episodeNumber + ": " + episode.title}}'
      div '.web-video-blk', vIf: 'episode',->
        video '.video', 
          vAttr:'src: videoUrl'
          autoplay:yes
          preload:'auto'
          vOn:'click:chkVidInit, playing: vidPlay'
            
  data: ->
    bigVideo: no
    videoUrl: ''
    videoState: 'none'
    
  methods:
    vidPlay: -> @vidHasPlayed = yes
      
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
      
  events:
    videoEnable: ->
      switch @videoState 
        when 'none'
          setTimeout => 
            @videoEnable()
            @videoEle.muted = yes
          , 100
        when 'loaded'
          @$emit 'videoCmd', 'play'
          @videoState = 'enabled'
          @videoEle.muted = yes
          
    videoCmd: (cmd, playPos) ->
      if not @videoEle then return
      @videoEle.muted = yes
      switch cmd
        when 'playPos'
          log 'videoCmd playPos @videoEle.play()'
          @videoEle.play()
          playPosAdj = playPos
          if tvGlobal.tvCtrl.skipping is -1
            playPosAdj += vidPosOfsBack
            log 'vidPosOfs', playPos, playPosAdj
          else if tvGlobal.tvCtrl.skipping is +1
            playPosAdj += vidPosOfsFwd
            log 'vidPosOfs', playPos, playPosAdj
          else
            playPosAdj += vidPosOfsPlay
          playPosAdj = Math.max playPosAdj, 0
          log 'videoCmd playPos1', @videoEle.currentTime, playPosAdj
          if Math.abs(@videoEle.currentTime - playPosAdj) > 1
            log 'videoCmd playPos2', @videoEle.currentTime, playPosAdj
            @videoEle.currentTime = playPosAdj
        when 'play'
          log '@videoEle.play()'
          @videoEle.play()
        when 'pause'
          log '@videoEle.pause()'
          @videoEle.pause()
        when 'stop' 
          log '@videoEle.stop()'
          @videoEle.src = ''
          
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
    
