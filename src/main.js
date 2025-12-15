import {createApp} from 'vue'
import App         from './components/App.vue'

const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
if (!isDevelopment) {
	// Remove debug noise in production.
	console.log = () => {};
	if (typeof console.debug === 'function') console.debug = () => {};
}

const app = createApp(App);
app.mount('#app')
