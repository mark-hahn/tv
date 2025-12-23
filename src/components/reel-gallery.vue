<template lang="pug">

#reelGallery(
  :style="{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px' }")
  
  div(
    v-for="(tvdb, idx) in tvdbList"
    :key="tvdb.id || idx"
    @click="selectCard(idx)"
    :style="getCardStyle(idx)")
    
    img(
      v-if="tvdb.image"
      :src="tvdb.image"
      :style="{ width: '100%', height: 'auto', borderRadius: '5px' }")
    
    div(:style="{ padding: '10px', fontSize: '16px', textAlign: 'center', fontWeight: 'bold' }")
      | {{ tvdb.year }} - {{ tvdb.name }}

</template>

<script>
import { ref, watch, onMounted } from 'vue';
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

    const getCardStyle = (idx) => {
      return {
        cursor: 'pointer',
        backgroundColor: idx === selectedIdx.value ? '#fffacd' : 'white',
        border: '1px solid #ccc',
        borderRadius: '5px',
        overflow: 'hidden'
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
        if (data && data.length > 0) {
          tvdbList.value = data;
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
      getCardStyle,
      selectCard
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
