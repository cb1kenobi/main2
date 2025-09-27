import { describe, it, expect } from 'vitest';
import {
	cache,
	config,
	configDirs,
	data,
	dataDirs,
	expand,
	home,
	runtime,
	state,
	tmp
} from '../src/paths.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('paths', () => {
	describe('cache()', () => {
		it('should get the cache directory', () => {
			expect(cache()).toBeTruthy();
		});

		it('should get the cache directory plus additional paths', () => {
			let dir = cache('foo', 'bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));

			dir = cache('foo/', '/bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));
		});
	});

	describe('config()', () => {
		it('should get the config directory', () => {
			expect(config()).toBeTruthy();
		});

		it('should get the config directory plus additional paths', () => {
			let dir = config('foo', 'bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));

			dir = config('foo/', '/bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));
		});
	});

	describe('configDirs()', () => {
		it('should get the config directories', () => {
			expect(configDirs()).toBeTruthy();
		});
	});

	describe('data()', () => {
		it('should get the data directory', () => {
			expect(data()).toBeTruthy();
		});

		it('should get the data directory plus additional paths', () => {
			let dir = data('foo', 'bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));

			dir = data('foo/', '/bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));
		});
	});

	describe('dataDirs()', () => {
		it('should get the data directories', () => {
			expect(dataDirs()).toBeTruthy();
		});
	});

	describe('expand()', () => {
		it('should expand home directory', () => {
			expect(expand('~')).toBe(homedir());
		});

		it('should expand home directory plus additional paths', () => {
			let dir = expand('~', 'foo', 'bar');
			expect(dir).toBe(join(homedir(), 'foo', 'bar'));

			dir = expand('~', 'foo/', '/bar');
			expect(dir).toBe(join(homedir(), 'foo', 'bar'));
		});
	});

	describe('home()', () => {
		it('should get the home directory', () => {
			expect(home()).toBe(homedir());
		});

		it('should get the home directory plus additional paths', () => {
			let dir = home('foo', 'bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));

			dir = home('foo/', '/bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));
		});
	});

	describe('runtime()', () => {
		it('should get the runtime directory', () => {
			expect(runtime()).toBeTruthy();
		});

		it('should get the runtime directory plus additional paths', () => {
			let dir = runtime('foo', 'bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));

			dir = runtime('foo/', '/bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));
		});
	});

	describe('state()', () => {
		it('should get the state directory', () => {
			expect(state()).toBeTruthy();
		});

		it('should get the state directory plus additional paths', () => {
			let dir = state('foo', 'bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));

			dir = state('foo/', '/bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));
		});
	});

	describe('tmp()', () => {
		it('should get the tmp directory', () => {
			expect(tmp()).toBeTruthy();
		});

		it('should get the tmp directory plus additional paths', () => {
			let dir = tmp('foo', 'bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));

			dir = tmp('foo/', '/bar');
			expect(dir).toBeTruthy();
			expect(dir).toContain(join('foo', 'bar'));
		});
	});
});
