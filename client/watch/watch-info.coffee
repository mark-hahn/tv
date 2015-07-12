
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
  props: ['show', 'episode', 'videoFile', 'watchMode', 'getPlayPos']
  
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
          # vOn:'click:onClick'
        div '.web-video-ctrls', ->
          div '.ctrl-row.web-video-ctrls', ->
            div '.btn.playCtl', vOn: 'click: vidCtrlClk', '<<'
            div '.btn.playCtl', vOn: 'click: vidCtrlClk', '{{vidPlayPauseTxt}}'
            div '.btn.playCtl', vOn: 'click: vidCtrlClk', '>>'
          div '.ctrl-row.web-video.bookmarks', ->
            div '.btn', vOn: 'click: vidCtrlClk', 'Prev'
            div '.btn', vOn: 'click: vidCtrlClk', 'Mark'
            div '.btn', vOn: 'click: vidCtrlClk', 'Next'
  methods:
    vidCtrlClk: ->
      
  computed:
    bannerUrl: -> tvGlobal.plexPfx + @show.banner
    videoUrl: -> 
      # log 'computed videoUrl', @episode, @videoFile
      tvGlobal.tvSrvrPfx + '/' + encodeURIComponent @videoFile + '.mp4'
    vidPlayPauseTxt: ->
      switch @watchMode
        when 'paused' then '>'
        else '||'

  events:
    videoCmd: (cmd, playPos) ->
      if not @videoEle then return
      switch cmd
        when 'play'  then @videoEle.play()
        when 'pause' then @videoEle.pause()
        when 'playPos'
          videoTime = @videoEle.currentTime
          if Math.abs(videoTime - playPos) > 0.2
            # log 'adjusting playpos', playPos - videoTime
            @videoEle.currentTime = playPos
        
    setPlayState: (state) ->
      if state is 'playing' then @videoEle.play()
      if state is 'paused'  then @videoEle.pause()

  attached: -> 
    @videoEle = @$el.querySelector 'video'
    @getPlayPos = => @videoEle.currentTime 
    
