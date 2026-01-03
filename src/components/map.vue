<template lang="pug">
#map(ref="mapScroller" @click="handleMapClick" :style="{ height:'100%', width:'100%', margin:0, display:'flex', flexDirection:'column', backgroundColor:'#ffe', overflow:'hidden', maxWidth:'100%', boxSizing:'border-box' }")

  //- Progress modal (similar to web-add in list.vue)
  #mapWorkingModal(
    v-if="mapWorking"
    @click.stop
    style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background-color:white; padding:30px 40px; border:2px solid black; border-radius:10px; box-shadow:0 4px 6px rgba(0,0,0,0.3); z-index:1000; text-align:center;"
  )
    div(style="font-size:18px; font-weight:bold; margin-bottom:10px;") {{ mapWorkingTitle }}
    div(style="font-size:20px; color:#0066cc; margin-bottom:15px;") {{ mapWorkingShowName }}
    div(style="font-size:16px; color:#666; margin-bottom:6px;") {{ mapWorkingStatus || 'Please wait ...' }}

  #maperr(v-if="mapError && Object.keys(seriesMap).length === 0"
      style="display:flex; align-items:center; justify-content:center; height:100%; width:100%; font-size:20px; font-weight:bold; color:red; text-align:center; padding:20px;")
    | {{mapError}}

  #maphdr(v-else style="position:sticky; top:0px; z-index:50; background-color:#ffe; padding-bottom:5px;")
    #maphdr1(style="margin:0 5px; display:flex; justify-content:space-between; align-items:center;")
      #mapshow(:style="{ marginLeft:'15px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px' }")
        | {{mapShow?.Name}} 
      div(style="display:flex; ")
        #mapnoemby(v-if="mapShow?.Id?.startsWith('noemby-')"
            @click.stop.prevent="handleNotInEmbyClick($event)"
            style="font-weight:bold; color:red; font-size:14px; white-space:nowrap; margin:8px; max-height:24px; cursor:pointer;") Not In Emby
        #mapbuttons(v-if="!simpleMode" style="display:flex; gap:5px; flex-shrink:0;")
          button(
            @click.stop.prevent="noop"
            @pointerdown.stop.prevent="startArrowPan($event, -1)"
            @pointerup.stop.prevent="stopArrowPan"
            @pointercancel.stop.prevent="stopArrowPan"
            @lostpointercapture.stop.prevent="stopArrowPan"
            :disabled="!canPanLeft"
            :style="{ opacity: canPanLeft ? 1 : 0.35, cursor: canPanLeft ? 'pointer' : 'default' }"
            style="font-size:15px; margin:5px; max-height:24px; border-radius:7px;"
          ) ←
          button(
            @click.stop.prevent="noop"
            @pointerdown.stop.prevent="startArrowPan($event, 1)"
            @pointerup.stop.prevent="stopArrowPan"
            @pointercancel.stop.prevent="stopArrowPan"
            @lostpointercapture.stop.prevent="stopArrowPan"
            :disabled="!canPanRight"
            :style="{ opacity: canPanRight ? 1 : 0.35, cursor: canPanRight ? 'pointer' : 'default' }"
            style="font-size:15px; margin:5px; max-height:24px; border-radius:7px;"
          ) →
          button(v-if="!mapShow?.Id?.startsWith('noemby-')" @click.stop="$emit('reload-shows')" style="font-size:15px; cursor:pointer; margin:5px 0 5px 5px; max-height:24px; border-radius:7px;") Refresh
          button(v-if="!mapShow?.Id?.startsWith('noemby-')" @click.stop="$emit('prune', mapShow)" style="font-size:15px; cursor:pointer; margin:5px 0 5px 5px; max-height:24px; border-radius:7px;") Prune

    #maphdr2(style="display:flex; justify-content:space-between; align-items:center; color:red; margin:0 10px 5px 10px; padding-left:5px; font-size:15px;")
      #dates(v-if="datesLine" :style="{  paddingLeft:'5px'}")
        span {{firstAiredVal}}
        span(v-if="firstAiredVal && lastAiredVal" style="font-weight:bold;") &nbsp;/&nbsp;
        span {{lastAiredVal}}
      #mapstatus(style="margin:6px;") {{statusVal}}
      #gaps(v-if="mapShow?.WatchGap || mapShow?.FileGap  || mapShow?.WaitStr?.length"
            style="display:flex; gap:15px;")
          div(v-if="mapShow?.WatchGap")
            | {{"Watch Gap"}}

          div(v-if="mapShow?.FileGap")
            | {{"Missing File"}}

          div(v-if="mapShow?.WaitStr?.length")
            | {{'Waiting ' + mapShow?.WaitStr}}
  #maptable(v-if="!hideMapBottom" style="flex:1 1 auto; min-height:0px; margin-left:15px; margin-right:15px; box-sizing:border-box; position:relative; overflow:hidden;")
    //- No scrollbars: pan the table with arrows (horizontal) and mouse wheel (vertical).
    #maptblpane(ref="mapViewport"
      @wheel.stop.prevent="handleMapWheel"
      @pointerdown="handleMapPointerDown"
      @pointermove="handleMapPointerMove"
      @pointerup="handleMapPointerUp"
      @pointercancel="handleMapPointerUp"
      style="position:absolute; inset:0; overflow:hidden; box-sizing:border-box; touch-action:none;")
      //- Sticky header row: moves horizontally with pan but stays fixed vertically.
      div(ref="mapHeader" style="position:absolute; left:0; right:0; top:0; overflow:hidden; box-sizing:border-box; background-color:#ffe; pointer-events:none;")
        table(:style="{ fontSize:'16px', borderCollapse:'collapse', transform: 'translate(' + (-mapScrollLeft) + 'px,0px)' }")
          tbody
            tr(style="font-weight:bold;")
              td(:style="{ width:'30px', minWidth:'30px', maxWidth:'30px', height:'22px', minHeight:'22px', maxHeight:'22px', lineHeight:'16px', whiteSpace:'nowrap', verticalAlign:'middle', textAlign:'center', padding:'1px 4px', border:'1px solid #ccc', backgroundColor:'#ffe' }") &nbsp;
              td(v-for="episode in seriesMapEpis"
                :style="{ width:'30px', minWidth:'30px', maxWidth:'30px', height:'22px', minHeight:'22px', maxHeight:'22px', lineHeight:'16px', whiteSpace:'nowrap', verticalAlign:'middle', padding:'1px 4px', textAlign:'center', border:'1px solid #ccc', backgroundColor:'#ffe' }"
                :key="episode") {{episode}}

      //- Sticky top-left corner cell (covers the moving blank header cell when panning horizontally).
      div(style="position:absolute; left:0; top:0; z-index:6; overflow:hidden; background-color:#ffe; pointer-events:none;")
        table(:style="{ fontSize:'16px', borderCollapse:'collapse' }")
          tbody
            tr(style="font-weight:bold;")
              td(:style="{ width:'30px', minWidth:'30px', maxWidth:'30px', height:'22px', minHeight:'22px', maxHeight:'22px', lineHeight:'16px', whiteSpace:'nowrap', verticalAlign:'middle', textAlign:'center', padding:'1px 4px', border:'1px solid #ccc', backgroundColor:'#ffe' }") &nbsp;

      //- Body viewport starts below the sticky header.
      div(ref="mapBodyViewport" :style="{ position:'absolute', left:'0', right:'0', top: mapHeaderH + 'px', bottom:'0', overflow:'hidden', boxSizing:'border-box' }")
        table(ref="mapBodyTable" :style="{ fontSize:'16px', borderCollapse:'collapse', transform: 'translate(' + (-mapScrollLeft) + 'px,' + (-mapScrollTop) + 'px)' }")
          tbody
            tr(v-for="season in seriesMapSeasons" :key="season"
                      style="outline:thin solid;")
              td(@click="handleSeasonClick($event, season)"
                  :style="{ fontWeight:'bold', width:'30px', minWidth:'30px', maxWidth:'30px', height:'22px', minHeight:'22px', maxHeight:'22px', lineHeight:'16px', whiteSpace:'nowrap', verticalAlign:'middle', textAlign:'center', cursor: simpleMode ? 'default' : 'pointer', padding:'1px 4px', border:'1px solid #ccc', backgroundColor:'#ffe' }")
                | {{season}}

              td(v-for="episode in seriesMapEpis" :key="season + '.' + episode"
                  @click="handleEpisodeClick($event, mapShow, season, episode)"
                  :style="{ cursor: simpleMode ? 'default' : 'pointer', width:'30px', minWidth:'30px', maxWidth:'30px', height:'22px', minHeight:'22px', maxHeight:'22px', lineHeight:'16px', whiteSpace:'nowrap', verticalAlign:'middle', padding:'1px 4px', textAlign:'center', border:'1px solid #ccc', backgroundColor: (seriesMap[season]?.[episode]?.error) ? 'yellow': (seriesMap[season]?.[episode]?.noFile) ? '#faa' : 'white'}")
                span(v-if="seriesMap?.[season]?.[episode]?.played")  w
                span(v-if="seriesMap?.[season]?.[episode]?.avail && !seriesMap?.[season]?.[episode]?.unaired && !mapShow?.Id?.startsWith('noemby-')")   +
                span(v-if="seriesMap?.[season]?.[episode]?.noFile && !seriesMap?.[season]?.[episode]?.unaired")  -
                span(v-if="seriesMap?.[season]?.[episode]?.unaired && !seriesMap?.[season]?.[episode]?.played && seriesMap?.[season]?.[episode]?.noFile") u
                span(v-if="seriesMap?.[season]?.[episode]?.deleted") d

      //- Sticky season column (covers the moving season cells when panning horizontally).
      div(
        @pointerdown="handleMapPointerDown"
        @pointermove="handleMapPointerMove"
        @pointerup="handleMapPointerUp"
        @pointercancel="handleMapPointerUp"
        :style="{ position:'absolute', left:'0', top: mapHeaderH + 'px', bottom:'0', width:'30px', overflow:'hidden', zIndex:5, backgroundColor:'#ffe', pointerEvents:'auto', touchAction:'none' }")
        table(:style="{ fontSize:'16px', borderCollapse:'collapse', transform: 'translate(0px,' + (-mapScrollTop) + 'px)' }")
          tbody
            tr(v-for="season in seriesMapSeasons" :key="'sticky-' + season" style="outline:thin solid;")
              td(@click="handleSeasonClick($event, season)"
                 :style="{ fontWeight:'bold', width:'30px', minWidth:'30px', maxWidth:'30px', height:'22px', minHeight:'22px', maxHeight:'22px', lineHeight:'16px', whiteSpace:'nowrap', verticalAlign:'middle', textAlign:'center', cursor: simpleMode ? 'default' : 'pointer', padding:'1px 4px', border:'1px solid #ccc', backgroundColor:'#ffe' }")
                | {{season}}
</template>

<script>
import * as tvdb from '../tvdb.js';
import * as emby from '../emby.js';
import * as srvr from '../srvr.js';
import    evtBus  from '../evtBus.js';

const MAP_ARROW_PAN_PX_PER_SEC = 400;
const MAP_PAN_SMOOTH_TAU_SEC = 0.10;

export default {
  name: "Map",

  props: {
    mapShow: {
      type: Object,
      default: null
    },
    hideMapBottom: {
      type: Boolean,
      default: true
    },
    seriesMapSeasons: {
      type: Array,
      default: () => []
    },
    seriesMapEpis: {
      type: Array,
      default: () => []
    },
    seriesMap: {
      type: Object,
      default: () => ({})
    },
    mapError: {
      type: String,
      default: ''
    },
    simpleMode: {
      type: Boolean,
      default: false
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },

  data() {
    return {
      seasonStates: {}, // Track original state for each season
      tvdbData: null,
      allTvdb: null,
      nextUpTxt: '',

      mapWorking: false,
      mapWorkingTitle: '',
      mapWorkingShowName: '',
      mapWorkingStatus: '',

      mapScrollLeft: 0,
      mapScrollTop: 0,
      mapDesiredLeft: 0,
      mapHeaderH: 0,
      mapMaxScrollLeft: 0,
      mapMaxScrollTop: 0,
      arrowPanActive: false,
      mapPanRafId: 0,
      mapPanLastTs: 0,
      arrowPanTargetLeft: 0,
      arrowPanDir: 0,
      mapTouchActive: false,
      mapTouchPointerId: -1,
      mapTouchLastX: 0,
      mapTouchLastY: 0,
      mapTouchMoved: false,
      mapTouchMovedDist: 0,
      mapTouchSuppressClickUntil: 0
    };
  },

  computed: {
    datesLine() {
      if (!this.tvdbData) return '';
      const { firstAired, lastAired, status } = this.tvdbData;
      return ` ${firstAired || ''} ${lastAired || ''} ${status || ''}`;
    },
    firstAiredVal() {
      return this.tvdbData?.firstAired || '';
    },
    lastAiredVal() {
      return this.tvdbData?.lastAired || '';
    },
    statusVal() {
      return this.tvdbData?.status || '';
    },

    canPanLeft() {
      const eps = 0.5;
      return (this.mapScrollLeft || 0) > eps;
    },

    canPanRight() {
      const eps = 0.5;
      return (this.mapScrollLeft || 0) < (this.mapMaxScrollLeft || 0) - eps;
    }
  },

  watch: {
    async mapShow(newShow) {
      if (newShow && newShow.Name) {
        await this.loadTvdbData();
        await this.setNextWatch();
        this.$nextTick(() => {
          this.updateMapPanBounds();
        });
      }
    },
    seriesMapSeasons() {
      this.$nextTick(() => {
        this.updateMapPanBounds();
      });
    },
    seriesMapEpis() {
      this.$nextTick(() => {
        this.updateMapPanBounds();
      });
    }
  },

  emits: ['reload-shows', 'prune', 'set-date', 'close', 'episode-click', 'season-delete', 'show-actors'],

  async mounted() {
    if (this.mapShow && this.mapShow.Name) {
      await this.loadTvdbData();
      await this.setNextWatch();
    }
    this.$nextTick(() => {
      this.updateMapPanBounds();
    });
    window.addEventListener('resize', this.updateMapPanBounds);
  },

  beforeUnmount() {
    window.removeEventListener('resize', this.updateMapPanBounds);
    this.stopArrowPan();
    this.stopMapPanLoop();
  },

  methods: {
    noop() {},

    async handleNotInEmbyClick(event) {
      // Ctrl-click on "Not In Emby": create the server folder and refresh Emby.
      if (!event?.ctrlKey) return;

      const showName = String(this.mapShow?.Name || '').trim();
      const tvdbId = String(this.mapShow?.TvdbId || this.tvdbData?.tvdbId || this.tvdbData?.tvdb_id || '').trim();
      const seasons = Array.isArray(this.seriesMapSeasons)
        ? this.seriesMapSeasons
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b)
        : [];

      if (!showName) return;
      if (!tvdbId) {
        console.error('Map: Not In Emby ctrl-click missing tvdbId', { mapShow: this.mapShow, tvdbData: this.tvdbData });
        window.alert('Missing TvdbId; cannot create show folder.');
        return;
      }
      if (!this.tvdbData || typeof this.tvdbData !== 'object' || Object.keys(this.tvdbData).length === 0) {
        await this.loadTvdbData();
      }
      const hasTvdbData = !!this.tvdbData && typeof this.tvdbData === 'object' && Object.keys(this.tvdbData).length > 0;
      if (!hasTvdbData) {
        console.error('Map: Not In Emby ctrl-click missing tvdbData', { showName, tvdbId, tvdbData: this.tvdbData });
        window.alert('Missing TVDB data; cannot create show folder.');
        return;
      }

      const ok = window.confirm(`Create Emby folder + refresh library for "${showName}"?`);
      if (!ok) return;

      console.log('Map: Not In Emby ctrl-click', { showName, tvdbId, seasons });
      this.mapWorking = true;
      this.mapWorkingTitle = 'Creating show folder and refreshing Emby:';
      this.mapWorkingShowName = showName;
      this.mapWorkingStatus = 'Starting...';

      const setStatus = (txt) => {
        this.mapWorkingStatus = String(txt || '');
        console.log('Map: Not In Emby progress:', showName, this.mapWorkingStatus);
      };

      try {
        const res = await emby.createShowFolderAndRefreshEmby({
          showName,
          tvdbId,
          seriesMapSeasons: seasons,
          tvdbData: this.tvdbData,
          onStatus: setStatus,
          createTimeoutMs: 15000,
          refreshTimeoutMs: 120000,
        });

        if (!res?.createdFolder) {
          console.error('Map: createShowFolderAndRefreshEmby failed', { showName, tvdbId, res });
          window.alert(res?.err || 'Failed to create show folder.');
          return;
        }

        setStatus('Reloading shows...');
        // Trigger list reload so the show becomes a real Emby item.
        // Wait for List.newShows() to finish (web-add does this inline).
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };

          const timeoutMs = 60000;
          const t = setTimeout(() => {
            console.warn('Map: timed out waiting for show reload after library-refresh-complete');
            finish();
          }, timeoutMs);

          evtBus.emit('library-refresh-complete', {
            onDone: () => {
              clearTimeout(t);
              finish();
            },
          });
        });
      } finally {
        this.mapWorking = false;
        this.mapWorkingTitle = '';
        this.mapWorkingShowName = '';
        this.mapWorkingStatus = '';
      }
    },

    handleMapPointerDown(event) {
      if (!event) return;
      // Only handle touch/pen drag as "scroll". Mouse drag isn't expected UX here.
      const pt = event.pointerType || '';
      if (pt !== 'touch' && pt !== 'pen') return;

      this.stopArrowPan();
      this.stopMapPanLoop();
      this.updateMapPanBounds();

      this.mapTouchActive = true;
      this.mapTouchPointerId = (event.pointerId != null) ? event.pointerId : -1;
      this.mapTouchLastX = event.clientX || 0;
      this.mapTouchLastY = event.clientY || 0;
      this.mapTouchMoved = false;
      this.mapTouchMovedDist = 0;

      try {
        if (event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function' && event.pointerId != null) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      } catch (_) {
        // ignore
      }
    },

    handleMapPointerMove(event) {
      if (!this.mapTouchActive) return;
      if (!event) return;
      if (this.mapTouchPointerId !== -1 && event.pointerId != null && event.pointerId !== this.mapTouchPointerId) return;

      // Prevent the browser from doing page scroll/gesture handling.
      try { event.preventDefault(); } catch (_) { /* ignore */ }

      this.updateMapPanBounds();

      const x = event.clientX || 0;
      const y = event.clientY || 0;
      const dx = x - this.mapTouchLastX;
      const dy = y - this.mapTouchLastY;
      this.mapTouchLastX = x;
      this.mapTouchLastY = y;

      const movedThis = Math.abs(dx) + Math.abs(dy);
      this.mapTouchMovedDist += movedThis;
      if (!this.mapTouchMoved && this.mapTouchMovedDist >= 4) this.mapTouchMoved = true;

      // Native-scroll semantics: finger left => reveal right (scrollLeft increases).
      this.mapScrollLeft = this.clamp((this.mapScrollLeft || 0) - dx, 0, this.mapMaxScrollLeft || 0);
      this.mapDesiredLeft = this.mapScrollLeft;

      // Finger up => reveal lower rows (scrollTop increases).
      this.mapScrollTop = this.clamp((this.mapScrollTop || 0) - dy, 0, this.mapMaxScrollTop || 0);
    },

    handleMapPointerUp(event) {
      if (!this.mapTouchActive) return;
      if (event?.pointerId != null && this.mapTouchPointerId !== -1 && event.pointerId !== this.mapTouchPointerId) return;

      if (this.mapTouchMoved) {
        // A click can fire after touch drag; suppress the close action briefly.
        this.mapTouchSuppressClickUntil = Date.now() + 300;
      }
      this.mapTouchActive = false;
      this.mapTouchPointerId = -1;
    },

    clamp(val, min, max) {
      return Math.min(max, Math.max(min, val));
    },

    updateMapPanBounds() {
      const header = this.$refs.mapHeader;
      const viewport = this.$refs.mapBodyViewport;
      const table = this.$refs.mapBodyTable;
      if (header) {
        const hh = header.offsetHeight || 0;
        if (hh && hh !== this.mapHeaderH) this.mapHeaderH = hh;
      }
      if (!viewport || !table) return;

      const vw = viewport.clientWidth || 0;
      const vh = viewport.clientHeight || 0;
      const tw = table.offsetWidth || 0;
      const th = table.offsetHeight || 0;

      this.mapMaxScrollLeft = Math.max(0, tw - vw);
      this.mapMaxScrollTop = Math.max(0, th - vh);

      this.mapScrollLeft = this.clamp(this.mapScrollLeft, 0, this.mapMaxScrollLeft);
      this.mapScrollTop = this.clamp(this.mapScrollTop, 0, this.mapMaxScrollTop);

      this.mapDesiredLeft = this.clamp(this.mapDesiredLeft, 0, this.mapMaxScrollLeft);
    },

    stopMapPanLoop() {
      this.mapPanLastTs = 0;
      if (this.mapPanRafId) {
        cancelAnimationFrame(this.mapPanRafId);
        this.mapPanRafId = 0;
      }
    },

    ensureMapPanLoop() {
      if (this.mapPanRafId) return;

      const tick = (ts) => {
        if (!this.mapPanLastTs) this.mapPanLastTs = ts;
        let dt = Math.max(0, (ts - this.mapPanLastTs) / 1000);
        this.mapPanLastTs = ts;
        dt = Math.min(dt, 0.05);

        // If holding an arrow, move the desired X smoothly toward the target.
        if (this.arrowPanActive && this.arrowPanDir !== 0) {
          const delta = MAP_ARROW_PAN_PX_PER_SEC * dt * this.arrowPanDir;
          const next = this.mapDesiredLeft + delta;
          if (this.arrowPanDir > 0) {
            this.mapDesiredLeft = Math.min(next, this.arrowPanTargetLeft);
            if (this.mapDesiredLeft >= this.arrowPanTargetLeft) this.stopArrowPan();
          } else {
            this.mapDesiredLeft = Math.max(next, this.arrowPanTargetLeft);
            if (this.mapDesiredLeft <= this.arrowPanTargetLeft) this.stopArrowPan();
          }
        }

        // Ease current toward desired.
        const alpha = 1 - Math.exp(-dt / MAP_PAN_SMOOTH_TAU_SEC);
        this.mapScrollLeft = this.mapScrollLeft + (this.mapDesiredLeft - this.mapScrollLeft) * alpha;

        const doneX = Math.abs(this.mapDesiredLeft - this.mapScrollLeft) < 0.25;
        if (!this.arrowPanActive && doneX) {
          this.mapScrollLeft = this.mapDesiredLeft;
          this.stopMapPanLoop();
          return;
        }

        this.mapPanRafId = requestAnimationFrame(tick);
      };

      this.mapPanRafId = requestAnimationFrame(tick);
    },

    handleMapWheel(event) {
      if (this.simpleMode) return;
      if (!event) return;
      // Vertical pan only.
      this.updateMapPanBounds();
      // On Windows mouse wheels, one notch often produces a fairly large deltaY.
      // Scale it down so one wheel "click" pans roughly one row.
      const dy = (event.deltaY || 0);
      const scaledDy = dy * 0.125;
      this.mapScrollTop = this.clamp(this.mapScrollTop + scaledDy, 0, this.mapMaxScrollTop);
    },

    startArrowPan(event, dir) {
      if (this.simpleMode) return;
      if (dir !== -1 && dir !== 1) return;

      // If we're already at the end, do nothing.
      if (dir < 0 && !this.canPanLeft) return;
      if (dir > 0 && !this.canPanRight) return;

      this.updateMapPanBounds();

      // Sync desired with current before starting a new pan.
      this.mapDesiredLeft = this.clamp(this.mapDesiredLeft || this.mapScrollLeft, 0, this.mapMaxScrollLeft);

      // Press-and-hold should pan continuously to the edge.
      const target = (dir > 0) ? (this.mapMaxScrollLeft || 0) : 0;

      this.arrowPanActive = true;
      this.arrowPanDir = dir;
      this.arrowPanTargetLeft = target;
      this.ensureMapPanLoop();

      try {
        if (event?.currentTarget && typeof event.currentTarget.setPointerCapture === 'function' && event.pointerId != null) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      } catch (_) {
        // ignore
      }

      // Movement happens inside the shared map pan loop.
    },

    stopArrowPan() {
      this.arrowPanActive = false;
      this.arrowPanDir = 0;
    },

    scrollMapToLeft() {
      // Legacy: click-jump behavior removed in favor of press-and-hold.
    },

    scrollMapToRight() {
      // Legacy: click-jump behavior removed in favor of press-and-hold.
    },

    async loadTvdbData() {
      try {
        if (!this.allTvdb) {
          this.allTvdb = await tvdb.getAllTvdb();
        }
        if (this.mapShow && this.mapShow.Name) {
          this.tvdbData = this.allTvdb[this.mapShow.Name];
        }
      } catch (err) {
        console.error('loadTvdbData error:', err);
      }
    },
    handleMapClick(event) {
      if (Date.now() < (this.mapTouchSuppressClickUntil || 0)) return;
      // Background click returns to Series.
      // (In non-simple mode, clicks inside the table stop propagation.)
      this.$emit('close');
    },
    handleEpisodeClick(event, mapShow, season, episode) {
      if (this.simpleMode) {
        // Let it bubble to handleMapClick (which returns to Series).
        return;
      }
      event.stopPropagation(); // Prevent map click handler from switching tabs
      this.$emit('episode-click', event, mapShow, season, episode);
    },
    handleSeasonClick(event, season) {
      if (this.simpleMode) {
        // Let it bubble to handleMapClick (which returns to Series).
        return;
      }
      event.stopPropagation();

      // Ctrl-click: delete the entire Season <n> folder.
      if (event?.ctrlKey) {
        this.$emit('season-delete', event, this.mapShow, season);
        return;
      }
      
      const seasonEpisodes = this.seriesMap[season];
      if (!seasonEpisodes) return;

      // Initialize season state tracking if needed (save original state only once)
      if (!this.seasonStates[season]) {
        const episodeStates = {};
        Object.keys(seasonEpisodes).forEach(episodeNum => {
          const episode = seasonEpisodes[episodeNum];
          if (episode && !episode.unaired && !episode.deleted) {
            episodeStates[episodeNum] = episode.played || false;
          }
        });
        
        this.seasonStates[season] = {
          original: { ...episodeStates },
          currentState: 0 // 0=original, 1=all on, 2=all off
        };
      }

      const state = this.seasonStates[season];

      // Determine next state based on current state
      let targetState;
      if (state.currentState === 0) {
        targetState = 1; // First click: all watched
      } else if (state.currentState === 1) {
        targetState = 2; // Second click: all unwatched
      } else {
        targetState = 0; // Third click: restore original
      }

      state.currentState = targetState;

      // Apply the target state
      Object.keys(state.original).forEach(episodeNum => {
        let setWatched;
        if (targetState === 0) {
          setWatched = state.original[episodeNum];
        } else if (targetState === 1) {
          setWatched = true;
        } else {
          setWatched = false;
        }
        this.$emit('episode-click', event, this.mapShow, season, parseInt(episodeNum), setWatched);
      });
    },

    async setNextWatch() {
      if (!this.mapShow || !this.mapShow.Id) {
        this.nextUpTxt = '';
        return;
      }
      
      const afterWatched = await emby.afterLastWatched(this.mapShow.Id);
      const status = afterWatched.status;
      const readyToWatch = (status === 'ok');
      
      if (!this.mapShow.Id.startsWith('noemby') && status !== 'allWatched') {
        const {seasonNumber, episodeNumber} = afterWatched;
        const seaEpiTxt = `S${(''+seasonNumber).padStart(2, "0")} ` +
                          `E${(''+episodeNumber).padStart(2, "0")}`;
        if (readyToWatch) {
          this.nextUpTxt = ` &nbsp; Next Up: ${seaEpiTxt}`;
        } else {
          this.nextUpTxt = ` 
                &nbsp; Next Up: ${seaEpiTxt} 
                &nbsp; ${status === 'missing' ? 'No File' : 'Unaired'}`;
        }
      } else {
        this.nextUpTxt = '';
      }
    }
  }
};
</script>

<style scoped>
</style>
