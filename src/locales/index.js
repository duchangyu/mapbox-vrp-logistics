import { createI18n } from 'vue-i18n'
import en from './en.json'
import zh from './zh.json'
import de from './de.json'
import ja from './ja.json'
import fr from './fr.json'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en, zh, de, ja, fr }
})

export default i18n
