<template lang="pug">
.actor-card(style="display:flex; flex-direction:column; align-items:center; margin:5px; padding:8px; background-color:#f5f5f5; border-radius:6px; border:1px solid #ddd;")
  img(
    v-if="actor.image"
    :src="actor.image"
    :alt="actor.name"
    style="width:100px; height:130px; object-fit:cover; border-radius:4px; margin-bottom:5px; cursor:pointer;"
    @click.stop="openActorPage"
    @error="handleImageError"
  )
  .actor-name(style="font-weight:bold; font-size:11px; text-align:center; margin-bottom:3px;")
    | {{ actor.name }}
  .person-name(style="font-size:10px; color:#666; text-align:center;")
    | {{ actor.personName }}
</template>

<script>
export default {
  name: "Actor",
  
  props: {
    actor: {
      type: Object,
      required: true
    }
  },
  
  methods: {
    openActorPage() {
      if (this.actor.url) {
        window.open(this.actor.url, '_blank');
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
