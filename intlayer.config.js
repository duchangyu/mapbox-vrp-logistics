import { Locales } from 'intlayer'
import { syncJSON } from '@intlayer/sync-json-plugin'

const config = {
  internationalization: {
    locales: [
      Locales.ENGLISH,
      Locales.CHINESE,
      Locales.GERMAN,
      Locales.JAPANESE,
      Locales.FRENCH,
    ],
    defaultLocale: Locales.ENGLISH,
  },
  ai: {
    provider: 'deepseek',
    model: process.env.DEEPSEEK_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'deepseek-v4-pro',
    apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    temperature: 0.1,
    applicationContext: [
      '这是一个基于 Vue 3、Mapbox GL JS 和 vue-i18n 的物流路线优化演示应用。',
      '应用包含 3 点路线规划、时间矩阵、路线优化、地图匹配和物流配送 VRP 求解等功能。',
      '翻译应保持专业、简洁，适合地图、物流、配送、路线规划和前端操作界面。',
      '保留技术名词、API 名称、单位和占位符，例如 Mapbox、VRP、SFO、{count}、{n}、{name}。',
      '按钮、标签和错误提示应短而清晰，避免过度营销化表达。',
    ].join('\n'),
  },
  dictionary: {
    description: [
      'Vue + Mapbox logistics route optimization UI translations.',
      'Keep placeholders unchanged and preserve concise UI wording.',
      'Domain: route planning, matrix calculation, map matching, vehicle routing, logistics delivery.',
    ].join('\n'),
  },
  plugins: [
    syncJSON({
      format: 'vue-i18n',
      source: ({ locale }) => `./src/locales/${locale}.json`,
    }),
  ],
}

export default config
