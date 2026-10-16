import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';

import App from './App.vue';
import { VueDraggableGrid } from './plugins/vue-grid-layout';
import router from './router';
import i18n from './locales';

import { PrimeVue, FtTheme, ToastService } from './plugins/primevue';
// After the PrimeVue plugin, which loads the Tailwind layers the design system sits in
import './styles/redesign.css';
import { useTheme } from './composables/useTheme';
import { bootPrefs } from './datasource/boot';

const myApp = createApp(App);

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
myApp.use(pinia);
// Preferences of the redesign: load `fqu2.*` and replay the migration of the old keys, before any
// store or page reads them (the old keys are only ever read)
bootPrefs();
// Sets data-theme on <html> from the persisted mode, before the first paint of the app
useTheme();

myApp.use(PrimeVue, {
  theme: {
    preset: FtTheme,
    options: {
      darkModeSelector: '.ft-dark-theme',
      cssLayer: {
        name: 'primevue',
        order: 'theme, base, primevue',
      },
    },
  },
});
myApp.use(ToastService);

import Tooltip from 'primevue/tooltip';
myApp.directive('tooltip', Tooltip);

myApp.use(router);
myApp.use(i18n);
myApp.use(VueDraggableGrid);

myApp.config.errorHandler = (err, instance, info) => {
  console.error('[Vue Error]', err, info);
};

myApp.mount('#app');
