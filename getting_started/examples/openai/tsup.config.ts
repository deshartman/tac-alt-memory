import path from 'path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  esbuildOptions(options) {
    options.alias = {
      '@twilio/tac-core': path.resolve(__dirname, '../../../packages/core/src/index.ts'),
      '@twilio/tac-tools': path.resolve(__dirname, '../../../packages/tools/src/index.ts'),
      '@twilio/tac-server': path.resolve(__dirname, '../../../packages/server/src/index.ts'),
    };
    options.packages = 'external';
  },
});
