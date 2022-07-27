// 原i18n
import Vue from 'vue'
import VueI18n from 'vue-i18n'
import zhLocale from 'element-ui/lib/locale/lang/zh-CN'
import locale from 'element-ui/lib/locale'
import { SystemLanguageType } from '@/const'

import store from '@/store'
import cnLogin from '@/i18n/langs/cn/login'
import cnRegister from '@/i18n/langs/cn/register'
import cnPublicIndex from '@/i18n/langs/cn/public-index'
import enPublicIndex from '@/i18n/langs/en/public-index'

// 原 i18n
Vue.use(VueI18n)
const i18n = new VueI18n({
  // 数据来源于store
  locale: store.getters.language,
  messages: {
    // 繁体中文，先放置于同一个目录
    [SystemLanguageType.ZHCN]: {
      login: cnLogin,
      register: cnRegister,
      public: cnPublicIndex,
      ...zhLocale
    },
    [SystemLanguageType.EN]: {
      public: enPublicIndex
    }
  }
})
locale.i18n((key, value) => i18n.t(key, value)) // 为了实现element插件的多语言切换

export const setI18nLanguage = (Locale, instance = i18n) => {
  instance.locale = Locale
}

export default i18n
