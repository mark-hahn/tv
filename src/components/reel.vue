<template lang="pug">

#reelPane(
  :style="{ height:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'row', overflowY:'hidden', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box', gap: '10px' }")

  #reelLeft(
    :style="{ flex: '0 0 400px', height: '100%', display: 'flex', flexDirection: 'column' }")
    reel-gallery(
      :srchStr="srchStr"
      @select="handleGallerySelect")

  #reelRight(
    :style="{ flex: '1', height: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }")
    
    #reelInfo(
      :style="{ padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '5px', fontSize: '16px' }")
      div(v-if="curTvdb") {{ infoLine }}
    
    #reelDescr(
      :style="{ flex: '1', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '5px', overflowY: 'auto', fontSize: '14px', lineHeight: '1.5' }")
      div(v-if="curTvdb") {{ curTvdb.overview }}
    
    #reelButtons(
      :style="{ display: 'flex', gap: '10px', padding: '10px' }")
      button Load
      button Google
      button Imdb
      button Prev
      button Next
    
    #reelTitles(
      ref="titlesPane"
      :style="{ flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }")
      div(
        v-for="(item, idx) in titleStrings"
        :key="idx"
        @click="selectTitle(idx)"
        :style="getTitleCardStyle(idx)")
        template(v-if="item.rejectStatus === 'ok'")
          div {{ item.titleString }}
        template(v-else)
          div(:style="{ display: 'flex' }")
            div(:style="{ width: '120px', flexShrink: 0, backgroundColor: '#ffcccc', padding: '5px' }") {{ item.rejectStatus }}
            div(:style="{ flex: 1, padding: '5px' }") {{ item.titleString }}

</template>

<script>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import ReelGallery from './reel-gallery.vue';

export default {
  name: 'ReelPane',
  components: {
    ReelGallery
  },
  setup() {
    const srchStr = ref('Castle Rock');
    const curTitle = ref('');
    const curTvdb = ref(null);
    const titleStrings = ref([]);
    const selectedTitleIdx = ref(-1);
    const titlesPane = ref(null);

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
      return `${t.year || ''} | ${t.originalCountry || ''} | ${t.originalLanguage || ''} | ${t.network || ''} | ${t.averageRuntime || ''}`;
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
        backgroundColor,
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
      console.log('curTitle set to:', curTitle.value);
    };

    // Scroll to bottom when titleStrings changes
    watch(titleStrings, async () => {
      await nextTick();
      if (titlesPane.value) {
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
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
      // Test data
      titleStrings.value = [
        'documentary|Taylor Swift: The End of an Era',
        'documentary|Vantara: Sanctuary Stories',
        'ok|Castle Rock'
      ];

      // Load test tvdb object
      curTvdb.value = {
        "id": 385730,
        "name": "Somebody Somewhere",
        "slug": "somebody-somewhere",
        "image": "https://artworks.thetvdb.com/banners/v4/series/385730/posters/670a459298ada.jpg",
        "year": "2022",
        "originalCountry": "usa",
        "originalLanguage": "eng",
        "overview": "Sam is a true Kansan on the surface but beneath it all struggles to fit the hometown mold. As she grapples with loss and acceptance, singing is Sam's saving grace and leads her on a journey to discover herself and a community of outsiders that don't fit in but don't give up, showing that finding your people, and finding your voice, is possible. Anywhere. Somewhere.",
        "network": "HBO Max",
        "averageRuntime": 30
      };
    });

    return {
      srchStr,
      curTitle,
      curTvdb,
      titleStrings,
      selectedTitleIdx,
      parsedTitles,
      infoLine,
      titlesPane,
      getTitleCardStyle,
      handleGallerySelect,
      selectTitle
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
