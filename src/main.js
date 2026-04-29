import './assets/main.css'
import i18n from './locales'

import { createApp } from 'vue'
import App from './App.vue'

createApp(App).use(i18n).mount('#app')
