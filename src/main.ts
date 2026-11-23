import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { initializeGoogleSync } from './stores/poker'

createApp(App).use(router).mount('#app')
void initializeGoogleSync()
