import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { defineConfig } from 'rollup';
import { minify as esbuildMinifyPlugin } from 'rollup-plugin-esbuild';

function generateConfig(format: 'es' | 'cjs') {
	return {
		input: './src/index.ts',
		output: {
			dir: './dist',
			externalLiveBindings: false,
			format,
			freeze: false,
			preserveModules: false,
			sourcemap: true,
			entryFileNames: format === 'es' ? 'index.js' : 'index.cjs',
		},
		plugins: [
			process.env.SKIP_MINIFY
				? null
				: esbuildMinifyPlugin({
						minify: true,
						minifySyntax: true,
					}),
			typescript({
				tsconfig: './tsconfig.build.json',
			}),
			nodeResolve({ preferBuiltins: true }),
			commonjs(),
		],
	};
}

export default defineConfig([generateConfig('es'), generateConfig('cjs')]);
