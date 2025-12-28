import {createApp} from 'vue'
import App         from './components/App.vue'

// Console logs enabled in all environments
console.log('[client] boot', {
	ts: new Date().toISOString(),
	href: window.location.href,
	origin: window.location.origin,
});

const app = createApp(App);
app.mount('#app')
