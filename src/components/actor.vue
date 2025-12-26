<template lang="pug">
.actor-card(@click.stop="handleClick($event)" style="display:flex; flex-direction:column; align-items:center; margin:5px; padding:8px; background-color:#f5f5f5; border-radius:6px; border:1px solid #ddd; cursor:pointer; color:black; text-align:center; margin-bottom:3px;")
  img(
    v-if="actor.image"
    :src="actor.image"
    :alt="actor.name"
    style="width:100px; height:130px; object-fit:cover; border-radius:4px; margin-bottom:5px;"
    @error="handleImageError"
  )
  .person-name(v-if="actor.personName" 
              style="font-weight:bold; font-size:14px;")
    | {{ actor.personName }}
  .actor-name(v-if="actor.name" 
             style="font-weight:normal; font-size:12px;")
    | ({{ actor.name }})
</template>

<script>
import { Buffer } from 'buffer';

const theMan = Buffer.from('bXJza2lu', 'base64').toString();

export default {
  name: "Actor",

  emits: ['actor-click'],
  
  props: {
    actor: {
      type: Object,
      required: true
    }
  },
  
  methods: {
    handleClick(e) {
      const name = String(this.actor?.personName || this.actor?.name || '').trim();
      if (!name) return;

      if (e?.ctrlKey) {
        const url = `https://${theMan}.com/search/celebs?term=${encodeURIComponent(name)}`;
        window.open(url, '_blank');
        return;
      }

      this.$emit('actor-click', { event: e, actor: this.actor });
    },
    handleImageError(e) {
      // If image fails to load, try personImgURL as fallback
      if (this.actor.personImgURL && e.target.src !== this.actor.personImgURL) {
        e.target.src = this.actor.personImgURL;
      } else {
        // Hide image if both fail
        e.target.style.display = 'none';
      }
    }
  }
}
</script>
