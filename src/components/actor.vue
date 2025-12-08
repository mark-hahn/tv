<template lang="pug">
.actor-card(@click.stop="openActorPage" style="display:flex; flex-direction:column; align-items:center; margin:5px; padding:8px; background-color:#f5f5f5; border-radius:6px; border:1px solid #ddd; cursor:pointer; color:black; text-align:center; margin-bottom:3px;")
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
import * as srvr from '../srvr.js';

export default {
  name: "Actor",
  
  props: {
    actor: {
      type: Object,
      required: true
    }
  },
  
  methods: {
    async openActorPage() {
      if (this.actor.personName) {
        console.log('openActorPage: requesting URL for', this.actor.personName);
        const url = await srvr.getActorPage(this.actor.personName);
        console.log('openActorPage: received URL:', url);
        window.open(url);
      }
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
