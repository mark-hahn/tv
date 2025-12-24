<template lang="pug">

#reelGallery(
  ref="galleryPane"
  :style="{ flex: '1', minHeight: 0, height: '100%', overflowY: 'auto', overflowX: 'hidden', display: 'block', padding: '2px' }")
  
  div(
    v-for="(tvdb, idx) in tvdbList"
    :key="tvdb.id || idx"
    @click="selectCard(idx)"
    :style="getCardStyle(idx)")

    div(v-if="!getImageUrl(tvdb)" :style="{ width: '101px', margin: '0 auto', backgroundColor: '#e0e0e0', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#666', padding: '10px' }")
      | No Image
    
    img(
      v-else
      :src="getImageUrl(tvdb)"
      :style="{ width: '101px', margin: '0 auto', height: 'auto', borderRadius: '5px', display: 'block' }"
      @error="handleImageError($event)")
    
    div(:style="{ padding: '2px', fontSize: '12px', textAlign: 'center', fontWeight: 'bold' }")
      | {{ tvdb.year }} - {{ tvdb.name }}

</template>

<script>
import { ref, watch, onMounted, nextTick } from 'vue';
import { srchTvdbData } from '../tvdb.js';

export default {
  name: 'ReelGallery',
  props: {
    srchStr: {
      type: String,
      default: ''
    }
  },
  emits: ['select'],
  setup(props, { emit }) {
    const tvdbList = ref([]);
    const selectedIdx = ref(0);
    const galleryPane = ref(null);

    const getImageUrl = (tvdb) => {
      if (!tvdb) return null;
      // TVDB search results use `image_url` (full) and `thumbnail` (smaller)
      return tvdb.image_url || tvdb.thumbnail || tvdb.image || null;
    };

    const getCardStyle = (idx) => {
      return {
        cursor: 'pointer',
        backgroundColor: idx === selectedIdx.value ? '#fffacd' : 'white',
        border: '1px solid #ccc',
        borderRadius: '5px',
        overflow: 'hidden',
        width: '100%',
        boxSizing: 'border-box',
        display: 'block',
        position: 'relative',
        marginBottom: '4px'
      };
    };

    const selectCard = (idx) => {
      selectedIdx.value = idx;
      emit('select', tvdbList.value[idx]);
    };

    const loadTvdbData = async () => {
      if (!props.srchStr) return;
      
      try {
        const data = await srchTvdbData(props.srchStr);
        console.log('TVDB search results:', data);
        if (data && data.length > 0) {
          tvdbList.value = data;
          await nextTick();
          if (galleryPane.value) {
            galleryPane.value.scrollTop = 0;
          }
          // Auto-select first card
          selectedIdx.value = 0;
          emit('select', data[0]);
        } else {
          tvdbList.value = [];
        }
      } catch (err) {
        console.error('Error loading tvdb data:', err);
        tvdbList.value = [];
      }
    };

    const handleImageError = (event) => {
      console.error('Image failed to load:', event.target.src);
    };

    // Watch for srchStr changes
    watch(() => props.srchStr, () => {
      loadTvdbData();
    });

    // Load on mount
    onMounted(() => {
      loadTvdbData();
    });

    return {
      tvdbList,
      selectedIdx,
      galleryPane,
      getImageUrl,
      getCardStyle,
      selectCard,
      handleImageError
    };
  }
};
</script>

<style scoped>
#reelGallery::-webkit-scrollbar {
  width: 8px;
}

#reelGallery::-webkit-scrollbar-track {
  background: #f1f1f1;
}

#reelGallery::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

#reelGallery::-webkit-scrollbar-thumb:hover {
  background: #555;
}
</style>
