import {createApp} from 'vue'
import App         from './components/App.vue'

// Console logs enabled in all environments

const app = createApp(App);
app.mount('#app')

// Debug test code for reelgood API
if (true) {
  void (async () => {
    try {
      console.log('Testing Reelgood API...');
      
      // Start by fetching the home page
      console.log('Calling startReel...');
      const startResponse = await fetch('https://localhost:3001/api/startreel');
      const startResult = await startResponse.json();
      console.log('startReel result:', startResult);
      
      // Then get the next show
      console.log('Calling getReel...');
      const getResponse = await fetch('https://localhost:3001/api/getreel');
      const getResult = await getResponse.json();
      console.log('getReel result:', getResult);
    } catch (error) {
      console.error('Reelgood test error:', error);
    }
  })();
}
