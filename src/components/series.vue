<template lang="pug">

#series(@click="handleSeriesClick" :style="{ height:'100%', width:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box' }")

  #hdr(v-if="showHdr"
       :style="{ display:'flex', flexDirection:'column', gap:'10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', margin:'0px', marginBottom:'10px' }")
    div(
      :style="{ display:'grid', gridTemplateColumns:'1fr 3fr 1fr 3fr 1fr', alignItems:'center', width:'100%' }"
    )
      div(:style="{ gridColumn:'1 / span 2', marginLeft:'20px', marginRight:'20px', whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word' }") {{show.Name}}

      //- Simple mode: align left edge of Notes with right edge of image (end of poster column)
      div(v-if="simpleMode" :style="{ gridColumn:'3 / span 3', display:'flex', alignItems:'center' }")
        textarea(
          v-model="noteText"
          @click.stop
          @keydown.stop
          @keydown.enter.prevent.stop="onEnterBlur"
          @input="onNoteInput"
          @focus="onNoteFocus"
          @blur="onNoteBlur"
          rows="1"
          placeholder="Notes"
          :style="{ width: sizing.emailWidth || '200px', padding:'2px', fontSize:'14px', border:'none', backgroundColor:'#eee', resize:'none', height:'14px', lineHeight:'1.2', marginTop:'4px', marginRight:'10px', marginLeft:'0px' }"
        )
        textarea(
          v-model="emailText"
          @click.stop
          @keydown.stop
          @keydown.enter.prevent.stop="onEnterBlur"
          rows="1"
          placeholder="Email Mark"
          :style="{ width: sizing.emailWidth || '200px', padding:'2px', fontSize:'14px', border:'none', backgroundColor:'#eee', resize:'none', height:'14px', lineHeight:'1.2', marginTop:'4px', marginRight:'10px', marginLeft:'0px' }"
        )
        div(v-if="show?.Reject"
            style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px; margin-right:10px;") Banned From Download
        div(v-if="notInEmby"
            style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px; margin-right:10px; white-space:nowrap;") Not In Emby

      //- Non-simple mode: align left edge of Notes with left edge of infobox (start of infobox column)
      div(v-else :style="{ gridColumn:'4 / span 2', display:'flex', alignItems:'center' }")
        div(v-if="show?.Reject"
            style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px; margin-right:10px;") Banned From Download
        div(v-if="notInEmby"
            style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px; margin-right:10px; white-space:nowrap;") Not In Emby
        textarea(
          v-model="noteText"
          @click.stop
          @keydown.stop
          @keydown.enter.prevent.stop="onEnterBlur"
          @input="onNoteInput"
          @focus="onNoteFocus"
          @blur="onNoteBlur"
          rows="1"
          placeholder="Notes"
          :style="{ width: sizing.emailWidth || '200px', padding:'2px', fontSize:'14px', border:'none', backgroundColor:'#eee', resize:'none', height:'14px', lineHeight:'1.2', marginTop:'4px', marginRight:'10px', marginLeft:'0px' }"
        )
        button(
          @click.stop="deleteClick"
          style="font-size:15px; cursor:pointer; margin-left:10px; margin-top:3px; max-height:24px; border-radius: 7px;"
        ) Delete

  //- Layout: 1/9 whitespace, 1/3 poster, 1/9 whitespace, 1/3 infobox, 1/9 whitespace
  #body(
    :style="{ display:'grid', cursor:'default', width:'100%', gridTemplateColumns:'1fr 3fr 1fr 3fr 1fr', alignItems:'start' }"
  )
    //- Column 2: poster (1/3)
    #topLeft(
      @click.stop="handleBodyClick"
      :style="{ gridColumn:'2', minWidth:'0px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-start', textAlign:'center' }"
    )
      #poster(:style="{ width:'100%', display:'flex', justifyContent:'center', alignItems:'flex-start' }")

    //- Column 4: info box (1/3)
    #topRight(:style="{ gridColumn:'4', minWidth:'0px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-start' }")
      #infoBox(
        v-if="seriesReady"
        @click.stop="handleBodyClick"
        :style="{ margin:'0px 0 0px 0px', width:'100%', boxSizing:'border-box', overflow:'hidden', fontSize: sizing.seriesInfoFontSize || '20px', lineHeight: sizing.infoBoxLineHeight || '1.2', display:'flex', flexDirection:'column', textAlign:'center', fontWeight:'bold' }"
      )
        div(style="border:1px solid #ccc; border-radius:5px; padding:5px; width:100%; box-sizing:border-box;")
          //- Dates in one div; allow wrapping up to 2 lines
          #dates(
            v-if="dates && String(dates).length > 0"
            style="min-height:24px; white-space:normal; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2;"
          ) {{ dates }}
          #status(
            v-if="statusTxt.length > 0"
            v-html="statusTxt"
            style="min-height:20px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
          )
          #seasons(
            v-if="seasonsTxt.length > 0"
            v-html="seasonsTxt"
            style="min-height:24px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
          )
          //- Split only between "Watched" and the value; allow wrapping between them
          #watched(
            v-if="watchedValTxt && String(watchedValTxt).length > 0"
            style="min-height:24px; display:flex; flex-wrap:wrap; justify-content:center; column-gap:8px; row-gap:0px;"
          )
            div(style="white-space:nowrap;") Watched
            div(style="white-space:normal; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2;") {{ watchedValTxt }}
          #cntrylang(
            v-if="(cntryLangLeftTxt && cntryLangLeftTxt.length > 0) || (cntryLangRightTxt && cntryLangRightTxt.length > 0)"
            style="min-height:20px; display:flex; flex-wrap:wrap; justify-content:center; column-gap:8px; row-gap:0px;"
          )
            div(
              v-if="cntryLangLeftTxt && cntryLangLeftTxt.length > 0"
              style="white-space:nowrap;"
            ) {{ cntryLangLeftTxt }}
            div(
              v-if="cntryLangRightTxt && cntryLangRightTxt.length > 0"
              style="white-space:normal; overflow-wrap:anywhere; word-break:break-word;"
            ) {{ cntryLangRightTxt }}
          #mins(
            v-if="runtimeTxt.length > 0"
            v-html="runtimeTxt"
            style="min-height:20px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
          )
          //- Next Up: keep episode and suffix on separate lines
          #nextup(
            v-if="nextUpValTxt && String(nextUpValTxt).length > 0"
            style="min-height:32px; display:flex; flex-direction:column; align-items:center; justify-content:center;"
          )
            div(style="display:flex; column-gap:8px; justify-content:center;")
              div(style="white-space:nowrap;") Next Up
              div(style="white-space:nowrap;") {{ nextUpValTxt }}
            div(v-if="nextUpSuffixTxt && String(nextUpSuffixTxt).length > 0" style="white-space:nowrap;") {{ nextUpSuffixTxt }}
          #collection(
            v-if="collectionName"
            style="min-height:24px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;"
          )
            | {{ (collectionCount > 1) ? 'Collections' : 'Collection' }}: {{collectionName}}

      //- Notes input moved to header (simple + non-simple)



  #allButtons(style="display:flex; flex-direction:column; margin-top:15px; padding:0 10px; width:100%;")
    div(v-if="showSpinner")
      img(src="../../loading.gif"
          style="width:100px; height:100px; position:relative; top:20px; left:45px;")
    #remoteButtons(
      v-if="showRemotes"
        style="display:flex; flex-wrap:wrap; justify-content:flex-start; width:100%; cursor:default;"
    )
      div(
        v-for="remote in remotes"
        :key="remote.name"
        @click.stop="remoteClick(remote)"
        :style="{ margin:'5px 5px', padding: sizing.remoteButtonPadding || '10px', backgroundColor:'#eee', borderRadius:'7px', textAlign:'center', border:'1px solid black', fontWeight:'bold', fontSize: sizing.remoteFontSize || 'inherit', cursor:'pointer', userSelect:'none' }"
      )
        | {{remote.name}}
  
  #bot(:style="{ fontSize: sizing.overviewFontSize || '20px', padding:'10px' }") {{show.Overview}}

</template>

<script>
import evtBus from '../evtBus.js';
import * as tvdb from "../tvdb.js";
import * as emby from "../emby.js";
import * as srvr from "../srvr.js";

let allTvdb = null;

export default {
  name: "Series",

  props: {
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
      show: {Name:''},
      showHdr: false,
      seriesReady: false,
      emailText: '',
      noteText: '',
      lastSavedNoteText: '',
      noteCacheByShowName: {},
      noteSaveTimer: null,
      noteFocused: false,
      notePollTimer: null,
      notePollInFlight: false,
      dates: '',
      statusTxt: '',
      remoteShowName: '',
      remotes: [],
      seasonsTxt: '',
      watchedValTxt: '',
      cntryLangLeftTxt: '',
      cntryLangRightTxt: '',
      runtimeTxt: '',
      subs: '',
      subsActive:  false,
      showSpinner: false,
      showRemotes: false,
      nextUpValTxt: '',
      nextUpSuffixTxt: '',
      watchButtonTxtArr: [],
      episodeId: '',
      deletedTxt: '',
      notInEmby: false,
      collectionName: '',
      collectionCount: 0,
      currentTvdbData: null
    }
  },
  
  methods: {

    onEnterBlur(e) {
      try { e?.target?.blur?.(); } catch { /* ignore */ }
    },

    onNoteFocus() {
      this.noteFocused = true;
    },

    async onNoteBlur() {
      this.noteFocused = false;
      await this.commitNote();
    },

    onNoteInput() {
      // Auto-save while typing (debounced).
      const showName = this.show?.Name;
      if (!showName) return;

      this.noteCacheByShowName[showName] = this.noteText;
      this.show.Notes = this.noteText;

      if (this.noteSaveTimer) {
        clearTimeout(this.noteSaveTimer);
        this.noteSaveTimer = null;
      }
      this.noteSaveTimer = setTimeout(() => {
        this.noteSaveTimer = null;
        void this.saveNoteNow(false);
      }, 600);
    },

    async saveNoteNow(showAlertOnError) {
      const showName = this.show?.Name;
      if (!showName) return;

      if (this.noteText === this.lastSavedNoteText) return;

      try {
        await srvr.saveNote(showName, this.noteText);
        this.lastSavedNoteText = this.noteText;
        this.noteCacheByShowName[showName] = this.noteText;
        this.show.Notes = this.noteText;
      } catch (err) {
        console.error('Series: saveNote failed', { showName, err });
        if (showAlertOnError) window.alert(err?.message || String(err));
      }
    },

    async refreshNoteFromServer() {
      const showName = this.show?.Name;
      if (!showName) return;
      if (this.noteFocused) return;
      if (this.notePollInFlight) return;
      this.notePollInFlight = true;
      try {
        const res = await srvr.getNote(showName);
        const text = (typeof res === 'string') ? res : (res?.noteText ?? res?.text ?? '');
        const next = String(text ?? '');
        if (this.noteFocused) return;
        if (next === this.noteText) return;
        this.noteText = next;
        this.lastSavedNoteText = next;
        this.noteCacheByShowName[showName] = next;
        this.show.Notes = next;
      } catch (err) {
        console.error('Series: refreshNoteFromServer failed', { showName, err });
      } finally {
        this.notePollInFlight = false;
      }
    },

    async loadNote(showName) {
      if (!showName) return;

      // Immediately show cached note (if any) so the input is never blanked
      // just because the server is slow or temporarily failing.
      if (Object.prototype.hasOwnProperty.call(this.noteCacheByShowName, showName)) {
        const cached = this.noteCacheByShowName[showName];
        this.noteText = String(cached ?? '');
        this.lastSavedNoteText = this.noteText;
      }
      else if (this.show && this.show.Notes != null) {
        // Seed from show.Notes (populated by loadAllShows) before polling refresh.
        this.noteText = String(this.show.Notes ?? '');
        this.lastSavedNoteText = this.noteText;
      }

      try {
        const res = await srvr.getNote(showName);
        const text = (typeof res === 'string') ? res : (res?.noteText ?? res?.text ?? '');
        this.noteText = String(text ?? '');
        this.lastSavedNoteText = this.noteText;
        this.noteCacheByShowName[showName] = this.noteText;
        this.show.Notes = this.noteText;
      } catch (err) {
        console.error('Series: getNote failed', { showName, err });
        // Keep whatever is currently displayed (cached or user-entered).
      }
    },

    async commitNote() {
      const showName = this.show?.Name;
      if (!showName) return;

      if (this.noteSaveTimer) {
        clearTimeout(this.noteSaveTimer);
        this.noteSaveTimer = null;
      }

      await this.saveNoteNow(true);
    },

    getMapCounts(seriesMap) {
      try {
        const seasonKeys = Object.keys(seriesMap || {})
          .filter((s) => seriesMap?.[s] && Object.keys(seriesMap[s]).length > 0);
        const seasonCount = seasonKeys.length;
        const episodeCount = seasonKeys.reduce((sum, s) => {
          const epis = seriesMap?.[s] || {};
          return sum + Object.keys(epis).length;
        }, 0);
        return { seasonCount, episodeCount };
      } catch (e) {
        return { seasonCount: 0, episodeCount: 0 };
      }
    },

    async sendEmail() {
      if (!this.emailText.trim() || this.emailText === 'Email Sent') return;
      
      const textToSend = this.show.Name + '~' + this.emailText;
      
      try {
        await srvr.sendEmail(textToSend);
        console.log('Email sent to server:', textToSend);
        this.emailText = 'Email Sent';
      } catch (error) {
        console.error('Failed to send email:', error);
      }
    },

    async handleBodyClick() {
      // If there's text in the email box, send it instead of opening map
      if (this.simpleMode && this.emailText.trim() && this.emailText !== 'Email Sent') {
        await this.sendEmail();
        return;
      }
      
      // Otherwise open the map
      this.openMap(this.show);
    },

    async handleSeriesClick() {
      // If there's text in the email box, send it instead of opening map
      if (this.simpleMode && this.emailText.trim() && this.emailText !== 'Email Sent') {
        await this.sendEmail();
        return;
      }
      
      // Rotate panes: if coming from map, go to actors; otherwise go to map
      // Check if we should go to actors (this will be after map is shown)
      // For now, just open map - the map will handle going to actors
      this.openMap(this.show);
    },

    openMap(show) {
      console.log('Series: openMap called with show:', show?.Name);
      if (!show || !show.Name) {
        console.log('Series: No show to open map for');
        return;
      }
      evtBus.emit('openMap', show);
    },

    deleteClick() {
      console.log('Series, deleteClick:', this.show.Name);
      evtBus.emit('deleteShow', this.show);
    },

    torrentsClick() {
      evtBus.emit('showTorrentsPane', this.show);
    },

    mapClick() {
      evtBus.emit('mapAction', { action: 'open', show: this.show });
    },

    actorsClick() {
      evtBus.emit('showActorsPane');
    },

    remoteClick(remote) {
      const url = remote.url;
      if(url) window.open(url);
    },

    setDeleted(tvdbData) {
      const deleted = !!tvdbData?.deleted;
      // console.log('series, setDeleted:', deleted)
      if(deleted) this.deletedTxt = 'Deleted ' + tvdbData.deleted;
      else        this.deletedTxt = '';
      this.notInEmby = this.show.Id.startsWith('noemby-');
    },

    async setPoster(tvdbData) {
      const posterEl = document.getElementById('poster');
      if (!posterEl) return;

      const img = new Image();
      // Poster column is 25% of pane; fill that column.
      img.style.width = '100%';
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      // Cap poster height to keep the header compact.
      img.style.maxHeight = '220px';
      img.style.objectFit = 'contain';
      img.style.display = 'block';

      const src = tvdbData?.image || './question-mark.png';
      if (!tvdbData) {
        console.error('setPoster: tvdbData missing');
      } else if (!tvdbData.image) {
        console.error('image missing from tvdbData', tvdbData.name);
      }

      await new Promise((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = src;
      });

      posterEl.replaceChildren(img);
    },

    setDates(tvdbData) {
      const show = this.show;
      const {firstAired, lastAired, status} = tvdbData;
      const fa = firstAired || '';
      const la = lastAired || '';
      const st = status || '';
      // Dates (start/end) should be on one line and separate from status.
      if (fa && la) this.dates = `${fa} - ${la}`;
      else if (fa) this.dates = `${fa}`;
      else if (la) this.dates = `${la}`;
      else this.dates = '';
      this.statusTxt = st ? ` &nbsp; ${st}` : '';
    },

    async setSeasonsTxt(tvdbData) {
      if(!(tvdbData instanceof Object)) {
        console.error('setSeasonsTxt, tvdbData:', 
                       name, {tvdbData});
        return;
      }
      this.seasonsTxt = "";
      const show = this.show;
      const name = show.Name;
      if(!this.show.Id.startsWith('noemby-')) {
        const epiCounts = await emby.getEpisodeCounts(show);
        Object.assign(tvdbData, epiCounts);
        const fields = Object.assign({name}, epiCounts);
        tvdbData = await srvr.setTvdbFields(fields);
      }
      else {
        // noemby shows cannot have real watched state from Emby; prevent stale
        // tvdb.json values (name collisions / prior cached data) from showing up.
        if ((tvdbData.watchedCount ?? 0) !== 0) {
          tvdbData.watchedCount = 0;
          try {
            await srvr.setTvdbFields({ name, watchedCount: 0 });
          } catch (e) {
            // Non-fatal: UI will still display the corrected value.
          }
        }
      }
      allTvdb[name] = tvdbData;
      let seasonsTxt;
      const {episodeCount, seasonCount} = tvdbData;
      const watchedCount = this.show.Id.startsWith('noemby-') ? 0 : (tvdbData.watchedCount ?? 0);
      switch (seasonCount) {
        case 0:  
          console.error('setSeasonsTxt, no seasonCount:', name);
          return;
        case 1:  seasonsTxt = "1 Season"; break;
        default: seasonsTxt = `${seasonCount} Seasons`;
      }
      this.seasonsTxt = ` &nbsp; ${seasonsTxt}`;

      if (episodeCount > 0) {
        this.watchedValTxt = (watchedCount === episodeCount)
          ? `All ${episodeCount}`
          : `${watchedCount} of ${episodeCount}`;
      } else {
        this.watchedValTxt = '';
      }
    },

    setCntryLangTxt(tvdbData) {
      this.cntryLangLeftTxt = '';
      this.cntryLangRightTxt = '';
      this.runtimeTxt = '';

      let { originalCountry, originalLanguage, averageRuntime, originalNetwork } = tvdbData;

      const capWords = (raw) => {
        const s = String(raw || '').trim();
        if (!s) return '';
        // Keep exact-cased tokens like "UK".
        if (s === 'UK') return 'UK';
        // Capitalize each whitespace-separated word; preserve punctuation like "/" and "+".
        return s
          .toLowerCase()
          .split(/\s+/)
          .map((w) => (w ? (w[0].toUpperCase() + w.slice(1)) : ''))
          .join(' ');
      };

      originalNetwork = String(originalNetwork || '');
      const longNets = ['Amazon', 'Paramount+'];
      longNets.forEach((net) => {
        if (originalNetwork.includes(net)) originalNetwork = net;
      });

      if (originalCountry === 'gbr') originalCountry = 'UK';
      originalCountry = String(originalCountry || '');
      originalLanguage = String(originalLanguage || '');
      originalNetwork = String(originalNetwork || '');

      const countryDisp = String(originalCountry || '').trim().toUpperCase();
      const languageDisp = capWords(originalLanguage);
      const networkDisp = String(originalNetwork || '').trim().toUpperCase();

      const left = `${countryDisp}${countryDisp ? '/' : ''}${languageDisp}`.trim();
      const right = `${networkDisp}`.trim();
      if (left) this.cntryLangLeftTxt = left;
      if (right) this.cntryLangRightTxt = right;

      const rt = (averageRuntime !== undefined && averageRuntime !== null) ? String(averageRuntime) : '';
      if (rt) this.runtimeTxt = `${rt} Mins`;
    },

  async setNextWatch() {
      const afterWatched = await emby.afterLastWatched(this.show.Id);
      const status       = afterWatched.status;
      const readyToWatch = (status === 'ok');
      if(!this.show.Id.startsWith('noemby') && status !== 'allWatched') {
        const {seasonNumber, episodeNumber, episodeId} = afterWatched;

        // Defensive: never render "Eundefined" for malformed Emby items (e.g. Sxx.EXTRA).
        if (!Number.isFinite(+seasonNumber) || !Number.isFinite(+episodeNumber)) {
          this.nextUpValTxt = '';
          this.nextUpSuffixTxt = '';
          this.episodeId = '';
          return;
        }
        const seaEpiTxt = `S${(''+seasonNumber) .padStart(2, "0")} ` +
                          `E${(''+episodeNumber).padStart(2, "0")}`;
        if (readyToWatch) {
          this.episodeId = episodeId;
          this.nextUpValTxt = seaEpiTxt;
          this.nextUpSuffixTxt = '';
        }
        else {
          const suffix = (status === 'missing') ? 'No File' : 'Unaired';
          this.nextUpValTxt = seaEpiTxt;
          this.nextUpSuffixTxt = suffix;
        }
      }
      else {
        this.nextUpValTxt = '';
        this.nextUpSuffixTxt = '';
      }
      const watchButtonTxtArr = [];
      const devices = await srvr.getDevices();
      for(const device of devices) {
        if(!device.showName) {
          if(readyToWatch)
            watchButtonTxtArr.push(`Play on ${device.deviceName}`);
        }
        else watchButtonTxtArr.push(`Stop ${device.deviceName}`);
      }
      this.watchButtonTxtArr = watchButtonTxtArr.sort();
    },

    setRemotes() {
      this.remoteShowName  = this.show.Name;
      this.showSpinner     = false;
      this.showRemotes     = false;
      let  delayingSpinner = true;
      this.remotes         = [];
      setTimeout(() => {
        if(delayingSpinner) this.showSpinner = true;
        delayingSpinner = false;
      }, 1000);
      try {
        const remotes = allTvdb[this.show.Name]?.remotes;
        if (!remotes) {
          console.error('setRemotes: no allTvdb:', this.show.Name);
          this.showSpinner = false;
          this.showRemotes = false;
          delayingSpinner  = false;
          return;
        }
        this.remotes     = remotes;
        this.showSpinner = false;
        this.showRemotes = true;
        delayingSpinner  = false;
      } catch(err) {
        console.error('setRemotes:', err);
      }
    },

    async watchButtonClick(show, watchButtonTxt) {
      await emby.startStop(show, this.episodeId, watchButtonTxt);
      setTimeout(async () => {
        await this.setNextWatch();
      }, 1000);
    },
  },

  /////////////////  MOUNTED  /////////////////
  // series vue component at mounted phase
  // set everything in html
  mounted() {
    evtBus.on('setUpSeries', async (show) => { 
      allTvdb        = await tvdb.getAllTvdb();
      this.emailText = ''; // Clear email text when changing shows
      this.show      = show;
      this.showHdr   = true;
      this.seriesReady = false;

      // Load persistent note for this show.
      await this.loadNote(show?.Name);

      // Clear info fields so nothing renders until ready
      this.dates = '';
      this.statusTxt = '';
      this.seasonsTxt = '';
      this.watchedValTxt = '';
      this.cntryLangLeftTxt = '';
      this.cntryLangRightTxt = '';
      this.runtimeTxt = '';
      this.nextUpValTxt = '';
      this.nextUpSuffixTxt = '';
      this.remotes = [];
      this.showRemotes = false;
      this.showSpinner = false;
      this.collectionName = '';
      this.collectionCount = 0;
      
      // Set collection name(s)
      const collections = [];
      if (show.InToTry) collections.push('To Try');
      if (show.InContinue) collections.push('Continue');
      if (show.InMark) collections.push('Mark');
      if (show.InLinda) collections.push('Linda');
      if (show.IsFavorite) collections.push('Favorite');
      this.collectionName = collections.join(', ');
      this.collectionCount = collections.length;
      
      const tvdbData = allTvdb[show.Name];
      this.currentTvdbData = tvdbData; // Store for actors pane
      evtBus.emit('tvdbDataReady', { show, tvdbData }); // Send to App.vue
      await this.setDeleted(tvdbData);
      await this.setPoster(tvdbData);
      await this.setDates(tvdbData);
      await this.setSeasonsTxt(tvdbData);
      await this.setCntryLangTxt(tvdbData);
      await this.setNextWatch();
      await this.setRemotes();

      // Only show the info box (and email input) once everything is populated.
      this.seriesReady = true;
    });

    // While notes input is NOT focused, refresh note text from server once/sec.
    // (Keeps the notes display in sync with external edits.)
    this.notePollTimer = setInterval(() => {
      if (this.noteFocused) return;
      if (!this.show?.Name) return;
      void this.refreshNoteFromServer();
    }, 1000);

    // Keep the Series infobox totals in sync with the actual Map grid.
    // This matters for noemby shows where tvdb.json counts can be stale / mismatched.
    evtBus.on('seriesMapUpdated', async ({ show, seriesMap }) => {
      if (!show || !seriesMap) return;
      if (!this.show || this.show.Name !== show.Name) return;
      if (!this.show.Id?.startsWith('noemby-')) return;

      const { seasonCount, episodeCount } = this.getMapCounts(seriesMap);
      if (!episodeCount || !seasonCount) return;

      const seasonsTxt = seasonCount === 1 ? '1 Season' : `${seasonCount} Seasons`;
      this.seasonsTxt = ' &nbsp; ' + seasonsTxt;
      this.watchedValTxt = `0 of ${episodeCount}`;

      try {
        await srvr.setTvdbFields({ name: show.Name, seasonCount, episodeCount, watchedCount: 0 });
      } catch (e) {
        // Non-fatal: UI already corrected.
      }
    });

  },

  beforeUnmount() {
    if (this.notePollTimer) {
      clearInterval(this.notePollTimer);
      this.notePollTimer = null;
    }
    if (this.noteSaveTimer) {
      clearTimeout(this.noteSaveTimer);
      this.noteSaveTimer = null;
    }
  },
}
</script>

<style>
  #series {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  #series::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  button {
    cursor:pointer;
  }
</style>