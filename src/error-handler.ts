/* eslint-disable @typescript-eslint/no-explicit-any */

export function errorHandler(err: unknown): void {
	// TODO: improve error rendering
	console.error(err);

	process.exitCode = (err as { exitCode?: number }).exitCode ?? 1;
}
