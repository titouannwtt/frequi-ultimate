import { defineConfig } from 'vitest/config';

import createVuePlugin from '@vitejs/plugin-vue';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import AutoImport from 'unplugin-auto-import/vite';
import IconsResolve from 'unplugin-icons/resolver';
import Icons from 'unplugin-icons/vite';
import Components from 'unplugin-vue-components/vite';
import tailwindcss from '@tailwindcss/vite';

import { PrimeVueResolver } from '@primevue/auto-import-resolver';

let commitHash: string = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString();
} catch (error) {
  console.error('Failed to get commit hash. Running in this mode will not be supported.');
}

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __FORK_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    createVuePlugin({
      script: {
        defineModel: true,
      },
    }),
    Components({
      resolvers: [IconsResolve(), PrimeVueResolver()],
      dts: 'src/components.d.ts',
    }),
    Icons({
      compiler: 'vue3',
    }),
    AutoImport({
      imports: ['vue', 'vue-router', '@vueuse/core', 'pinia'],
      dts: 'src/auto-imports.d.ts',
      dirs: ['src/composables', 'src/stores', 'src/utils/**'],
      vueTemplate: true,
    }),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ['vue'],
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 700, // Default is 500
    // 'hidden' still emits the maps (so a build can be symbolicated after the fact)
    // but stops referencing them from the bundles, so browsers never fetch them.
    // They were 64 MB of the 86 MB dist.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        /**
         * Stop code-splitting things that are far smaller than an HTTP request.
         *
         * Measured on a browser capture of the multi-bot dashboard: 56 of the 79 static
         * files were under 20 kB, at a 441 ms median each, and they accounted for 23,7 s of
         * `blocked` time. Most were single icons at 300 to 700 bytes (`stop`, `play`,
         * `plus`, `chevron-down`, `pencil`, `robot`…), each one its own chunk because
         * unplugin-icons compiles every icon to its own module.
         *
         * They are slow for a reason that has nothing to do with their size: the UI is
         * served from the same origin as one of the bots, so those files queue behind that
         * bot's API calls in the same six-connection pool. On this capture the API calls on
         * that origin held 264 s of server wait between them. A 400-byte file waiting behind
         * a four-second aggregate is the whole problem, and the only fix is to ask for
         * fewer files.
         *
         * Icons and the PrimeVue runtime are the two families that are always needed
         * together and never alone, so each becomes one chunk. Route-level and widget-level
         * splitting is untouched: the point is to stop splitting BELOW the cost of a
         * request, not to stop splitting.
         */
        manualChunks(id: string) {
          if (id.includes('~icons/') || id.includes('unplugin-icons')) {
            return 'icons';
          }
          if (id.includes('node_modules/@primevue/') || id.includes('node_modules/primevue/')) {
            return 'primevue';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
    host: '127.0.0.1',
    port: 3000,
  },
  test: {
    environment: 'happy-dom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
    ],
  },
});
