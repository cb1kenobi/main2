import https from 'node:https';
import { dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

try {
	const {
		CACHE_FILE: cacheFile,
		PACKAGE_NAME: packageName,
		DIST_TAG: distTag = 'latest',
		REGISTRY_URL: registryURL = 'https://registry.npmjs.org'
	} = process.env;

	if (!packageName) {
		throw new Error('PACKAGE_NAME is not set');
	}

	if (!distTag) {
		throw new Error('DIST_TAG is not set');
	}

	if (!registryURL) {
		throw new Error('REGISTRY_URL is not set');
	}

	if (!registryURL.startsWith('https')) {
		throw new Error('REGISTRY_URL must use https');
	}

	const url = `${registryURL.replace(/\/$/, '')}/-/package/${packageName}/dist-tags`;
	const distTags = await new Promise((resolve, reject) => {
		const req = https.get(
			url,
			{
				headers: {
					accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'
				}
			},
			res => {
				let buf = '';
				res.on('data', chunk => {
					buf += chunk;
				});
				res.on('end', () => {
					try {
						if (res.statusCode && res.statusCode >= 400) {
							throw new Error(`Fetch dist-tags failed ${res.statusCode} ${res.statusMessage}`);
						}
						resolve(JSON.parse(buf));
					} catch (err) {
						reject(err);
					}
				});
			}
		);

		req.on('error', reject);
		req.end();
	});

	const version = distTags[distTag];
	if (!version) {
		throw new Error(`Dist tag "${distTag}" not found`);
	}

	if (cacheFile) {
		await mkdir(dirname(cacheFile), { recursive: true });
		let cache = {};
		try {
			const obj = JSON.parse(await readFile(cacheFile, 'utf-8'));
			if (obj && typeof obj === 'object') {
				cache = obj;
			}
		} catch {}
		cache.ts = Date.now();
		cache.version = version;
		await writeFile(cacheFile, JSON.stringify(cache));
	}

	console.log(version);
} catch (err) {
	console.error(err);
	process.exit(1);
}
