import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
const OUT = process.env.OUT || 'docs';
mkdirSync(OUT, { recursive: true });
cpSync('public', OUT, { recursive: true });
await esbuild.build({ entryPoints: { app: 'src/main.js' }, bundle: true, minify: true, sourcemap: false, format: 'iife', target: ['es2020', 'safari14'], outdir: OUT, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, charset: 'utf8', logLevel: 'warning' });
console.log('built ' + OUT + '/');
