import debug from '../debug/index.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const { log } = debug('main2:updates');
const oneDay = 86400000;

export interface CheckOptions {
	cacheDir?: string;
	checkInterval?: number;
	distTag?: string;
	force?: boolean;
	notifyInterval?: number;
	packageName: string;
	packageVersion: string;
	registryURL?: string;
	timeout?: number;
	wait?: boolean;
}

export async function check(opts: CheckOptions) {
	if (!opts || typeof opts !== 'object') {
		throw new TypeError('Update check options must be an object');
	}

	const {
		cacheDir,
		checkInterval = oneDay,
		distTag = 'latest',
		force = false,
		notifyInterval = oneDay,
		packageName,
		packageVersion,
		registryURL,
		timeout = 5000,
		wait = false
	} = opts;

	if (!packageName || typeof packageName !== 'string') {
		throw new TypeError('Update check package name must be a non-empty string');
	}

	if (!packageVersion || typeof packageVersion !== 'string') {
		throw new TypeError('Update check package version must be a non-empty string');
	}

	if (!distTag || typeof distTag !== 'string') {
		throw new TypeError('Update check dist tag must be a non-empty string');
	}

	const cacheFile = cacheDir ? join(cacheDir, `${packageName}-${distTag}.json`) : undefined;

	let cache;
	if (cacheFile) {
		log(`Cache file: ${cacheFile}`);
		try {
			cache = JSON.parse(readFileSync(cacheFile, 'utf-8'));
		} catch {}
	}

	if (force || !cache || !cache.ts || cache.ts + checkInterval < Date.now()) {
		const cwd = dirname(fileURLToPath(import.meta.url));
		const workerFile = join(cwd, 'get-version-worker.js');
		const workerScript = readFileSync(workerFile, 'utf-8');
		const env = {
			...process.env,
			CACHE_FILE:   cacheFile,
			DIST_TAG:     distTag,
			PACKAGE_NAME: packageName,
			REGISTRY_URL: registryURL
		};

		log('Spawning update worker...');
		const worker = spawn(process.execPath, [
			'--input-type', 'module'
		], {
			cwd,
			env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		worker.stdin.write(workerScript);
		worker.stdin.end();

		let stdout = '';
		worker.stdout.on('data', data => {
			stdout += data.toString();
		});

		let stderr = '';
		worker.stderr.on('data', data => {
			stderr += data.toString();
		});

		const prom = new Promise<void>((resolve, reject) => {
			let timer: NodeJS.Timeout;
			if (timeout) {
				timer = setTimeout(() => {
					worker.kill();
					reject(new Error('Update worker timed out'));
				}, timeout);
			}

			worker.on('close', code => {
				clearTimeout(timer);
				if (code) {
					reject(new Error(`Update worker error (code ${code})\n${stderr.trim()}`));
				} else {
					resolve();
				}
			});
		});

		if (wait) {
			await prom;
			log('Update worker finished successfully');
			if (cacheFile) {
				try {
					cache = JSON.parse(readFileSync(cacheFile, 'utf-8'));
				} catch {}
			} else {
				if (!cache) {
					cache = {};
				}
				cache.ts = Date.now();
				cache.version = stdout.trim();
			}
		} else {
			worker.disconnect();
		}
	}

	// TODO: notifyInterval

	log(`Current=${packageVersion} Latest=${cache?.version}`);

	return {
		current: packageVersion,
		latest: cache?.version
	};
}
