import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/migrate.ts', 'src/cli/create-admin.ts', 'src/cli/seed-demo.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package; keep real npm deps external.
  noExternal: ['@nodara/shared'],
});
