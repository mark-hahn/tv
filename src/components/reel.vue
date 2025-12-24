<template lang="pug">

#reelPane(
  :style="{ height:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'row', overflowY:'hidden', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', gap: '10px' }")

  #reelLeft(
    :style="{ flex: '0 0 125px', height: '100%', display: 'flex', flexDirection: 'column' }")
    reel-gallery(
      :style="{ flex: '1', minHeight: 0 }"
      :srchStr="srchStr"
      @select="handleGallerySelect")

  #reelRight(
    :style="{ flex: '1 1 0', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: '0' }")
    
    #reelInfo(
      :style="{ padding: '10px', marginBottom: '10px', backgroundColor: '#f5f5f5', borderRadius: '5px', fontSize: '14px', textTransform: 'uppercase' }")
      div(v-if="curTvdb" :style="{ fontWeight: 'bold', fontSize: '12px', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }") {{ galleryTitleLine }}
      div(v-if="curTvdb") {{ infoLine }}

    // keep zero gap between description and buttons
    #reelDescrButtons(:style="{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '0' }")
      #reelDescr(
        :style="{ flex: '0 0 auto', height: '120px', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '5px', overflowY: 'auto', fontSize: '14px', lineHeight: '1.5' }")
        div(v-if="curTvdb") {{ curTvdb.overview }}
      
      #reelButtons(
        :style="{ display: 'flex', gap: '10px', padding: '10px', marginTop: '0' }")
        button(:style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") Load
        button(:style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") Google
        button(:style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") Imdb
        button(:style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") Prev
        button(
          @click="handleNext"
          :style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") Next
    
    #reelTitles(
      ref="titlesPane"
      :style="{ flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0' }")
      div(
        v-for="(item, idx) in parsedTitles"
        :key="idx"
        @click="selectTitle(idx)"
        :style="getTitleCardStyle(idx)")
        template(v-if="item.rejectStatus === 'ok'")
          div {{ item.titleString }}
        template(v-else)
          div(:style="{ display: 'flex' }")
            div(:style="{ width: '80px', flexShrink: 0, backgroundColor: '#ffcccc', padding: '5px' }") {{ item.rejectStatus }}
            div(:style="{ flex: 1, padding: '5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }") {{ item.titleString }}

</template>

<script>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import ReelGallery from './reel-gallery.vue';
import { config } from '../config.js';

export default {
  name: 'ReelPane',
  components: {
    ReelGallery
  },
  props: {
    active: {
      type: Boolean,
      default: false
    },
    allShows: {
      type: Array,
      default: () => ([])
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },
  setup(props) {
    const srchStr = ref('friends');
    const curTitle = ref('');
    const curTvdb = ref(null);
    const titleStrings = ref([]);
    const selectedTitleIdx = ref(-1);
    const titlesPane = ref(null);
    const _titlesPopulated = ref(false);

    const scrollTitlesToBottom = async () => {
      await nextTick();
      if (titleStrings.value.length > 0) {
        selectTitle(titleStrings.value.length - 1);
      }
      await nextTick();
      if (titlesPane.value) {
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
      }
    };

    const getAllShowNames = () => {
      const src = Array.isArray(props.allShows) ? props.allShows : [];
      const names = src
        .map((s) => {
          if (!s) return '';
          if (typeof s === 'string') return s;
          return String(s.Name || s.name || s.title || s.showName || s.seriesName || '');
        })
        .map((s) => s.trim())
        .filter(Boolean);
      return Array.from(new Set(names));
    };

    const startReelAndLoadTitles = async () => {
      try {
        const showTitles = getAllShowNames();
        const res = await fetch(`${config.torrentsApiUrl}/api/startreel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ showTitles })
        });
        const data = await res.json();
        titleStrings.value = Array.isArray(data) ? data : [];
        _titlesPopulated.value = true;
        if (props.active) {
          await scrollTitlesToBottom();
        }
      } catch (e) {
        console.log('startReel failed:', e);
      }
    };

    const handleNext = async () => {
      try {
        const res = await fetch(`${config.torrentsApiUrl}/api/getreel`);
        const data = await res.json();
        const added = Array.isArray(data) ? data : [];
        titleStrings.value = [...titleStrings.value, ...added];

        await scrollTitlesToBottom();
      } catch (e) {
        console.log('getReel failed:', e);
      }
    };

    watch(() => props.active, async (isActive) => {
      if (!isActive) return;
      if (!_titlesPopulated.value) return;
      await scrollTitlesToBottom();
    });

    // Parse titleStrings into objects
    const parsedTitles = computed(() => {
      return titleStrings.value.map(str => {
        const parts = str.split('|');
        return {
          rejectStatus: parts[0],
          titleString: parts[1] || parts[0]
        };
      });
    });

    // Format info line from curTvdb
    const infoLine = computed(() => {
      if (!curTvdb.value) return '';
      const t = curTvdb.value;
      return `${t.year || ''} | ${t.country || ''} | ${t.primary_language || ''} | ${t.network || ''}`;
    });

    const galleryTitleLine = computed(() => {
      const t = curTvdb.value;
      if (!t) return '';
      return String(t.name || t.Name || t.seriesName || t.title || '').trim();
    });

    // Get style for title card
    const getTitleCardStyle = (idx) => {
      const item = parsedTitles.value[idx];
      let backgroundColor = 'white';
      
      if (idx === selectedTitleIdx.value) {
        backgroundColor = '#fffacd'; // light-yellow
      } else if (item.rejectStatus === 'ok') {
        backgroundColor = '#90ee90'; // light-green
      }
      
      return {
        padding: '5px',
        cursor: 'pointer',
        fontSize: '14px',
        backgroundColor,
        border: '1px solid #808080',
        borderRadius: '3px',
        minHeight: '30px',
        display: 'flex',
        alignItems: 'center'
      };
    };

    // Handle gallery card selection
    const handleGallerySelect = (tvdb) => {
      curTvdb.value = tvdb;
      console.log('curTvdb set to:', tvdb);
    };

    // Handle title selection
    const selectTitle = (idx) => {
      selectedTitleIdx.value = idx;
      curTitle.value = parsedTitles.value[idx].titleString;
      srchStr.value = curTitle.value;
      console.log('curTitle set to:', curTitle.value);
    };

    // Scroll to bottom when titleStrings changes
    watch(titleStrings, async () => {
      await nextTick();
      if (titlesPane.value) {
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
      }

      // Log parsed title cards for debugging
      try {
        parsedTitles.value.forEach((it, i) => {
          console.log('reelTitles item:', i, it.rejectStatus, it.titleString);
        });
      } catch (e) {
        console.log('reelTitles parse/log failed:', e);
      }

      // Select last item
      if (titleStrings.value.length > 0) {
        selectTitle(titleStrings.value.length - 1);
      }
    }, { deep: true });

    // Watch for logging
    watch(curTitle, (val) => {
      console.log('curTitle changed to:', val);
    });

    watch(curTvdb, (val) => {
      console.log('curTvdb changed to:', val);
    }, { deep: true });

    watch(titleStrings, (val) => {
      console.log('titleStrings changed to:', val);
    }, { deep: true });

    // Initialize with test data
    onMounted(() => {
      void startReelAndLoadTitles();
    });

    return {
      sizing: props.sizing,
      srchStr,
      curTitle,
      curTvdb,
      titleStrings,
      selectedTitleIdx,
      parsedTitles,
      infoLine,
      galleryTitleLine,
      titlesPane,
      getTitleCardStyle,
      handleGallerySelect,
      selectTitle,
      handleNext
    };
  }
};
</script>

<style scoped>
button {
  padding: 8px 16px;
  cursor: pointer;
  border: 1px solid #ccc;
  border-radius: 5px;
  background-color: white;
}

button:hover {
  background-color: #f0f0f0;
}
</style>
