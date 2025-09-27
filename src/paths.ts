// spec: https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html

import { homedir, tmpdir } from 'node:os';
import { delimiter, join, normalize } from 'node:path';

const paths = {
	darwin: {
		cache: '~/Library/Caches',
		config: '~/Library/Preferences',
		data: '~/Library/Application Support',
		state: '~/Library/state'
	},
	linux: {
		cache: '~/.cache',
		config: '~/.config',
		data: '~/.local/share',
		state: '~/.local/state'
	},
	win32: {
		cache: [
			'%LOCALAPPDATA%',
			'~/AppData/Local'
		],
		config: '~\\.config',
		data: [
			'%APPDATA%',
			'~/AppData/Roaming'
		],
		state: [
			'%LOCALAPPDATA%',
			'~/AppData/Local'
		]
	}
} as const;

let _cache: string | undefined;
let _config: string | undefined;
let _configDirs: string[] | undefined;
let _data: string | undefined;
let _dataDirs: string[] | undefined;
let _home: string | undefined;
let _state: string | undefined;
let _tmp: string | undefined;

export function cache(...paths: string[]) {
	if (!_cache) {
		_cache = resolvePath('XDG_CACHE_HOME', 'cache');
	}
	return _cache && paths ? join(_cache, ...paths) : _cache;
}

export function config(...paths: string[]) {
	if (!_config) {
		_config = resolvePath('XDG_CONFIG_HOME', 'config');
	}
	return _config && paths ? join(_config, ...paths) : _config;
}

export function configDirs() {
	if (!_configDirs) {
		_configDirs = combinePaths(
			config(),
			process.env.XDG_CONFIG_DIRS?.split(delimiter).map(p => expand(p))
		);
	}
	return _configDirs;
}

export function data(...paths: string[]) {
	if (!_data) {
		_data = resolvePath('XDG_DATA_HOME', 'data');
	}
	return _data && paths ? join(_data, ...paths) : _data;
}

export function dataDirs() {
	if (!_dataDirs) {
		_dataDirs = combinePaths(
			config(),
			process.env.XDG_DATA_DIRS?.split(delimiter).map(p => expand(p))
		);
	}
	return _dataDirs;
}

const homeDirRegExp = /^~([\\|/].*)?$/;
const winEnvVarRegExp = /(%([^%]*)%)/g;

/**
 * Resolves a path into an absolute path.
 *
 * @param segments - The path segments to join and resolvePath.
 * @returns the expanded path.
 */
export function expand(...segments) {
	segments[0] = segments[0].replace(homeDirRegExp, `${home()}$1`);

	if (process.platform === 'win32') {
		return normalize(join(...segments).replace(winEnvVarRegExp, (s, m, n) => {
			return process.env[n] || m;
		}));
	}

	return normalize(join(...segments));
}

export function home(...paths: string[]) {
	if (!_home) {
		_home = homedir();
	}
	return paths ? join(_home, ...paths) : _home;
}

export function runtime(...paths: string[]) {
	const dir = resolvePath('XDG_RUNTIME_DIR');
	return dir && paths ? join(dir, ...paths) : dir;
}

export function state(...paths: string[]) {
	if (!_state) {
		_state = resolvePath('XDG_STATE_HOME', 'state');
	}
	return _state && paths ? join(_state, ...paths) : _state;
}

export function tmp(...paths: string[]) {
	if (!_tmp) {
		_tmp = tmpdir();
	}
	return _tmp && paths ? join(_tmp, ...paths) : _tmp;
}

function combinePaths(primary: string | undefined, additional: string[] | undefined): string[] {
	const paths = new Set<string>();
	if (primary) {
		paths.add(primary);
	}

	if (additional) {
		for (const path of additional) {
			if (path) {
				paths.add(path);
			}
		}
	}

	return Array.from(paths);
}

function resolvePath(env: string, type?: string) {
	return process.env[env] || (type && resolveTypePath(type));
}

function resolveTypePath(type: string) {
	const dirs = paths[process.platform][type];
	if (Array.isArray(dirs)) {
		for (let dir of dirs) {
			dir = expand(dir);
			if (dir) {
				return dir;
			}
		}
	}
	return dirs;
}
