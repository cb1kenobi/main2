export function errorHandler(err: any) {
	// TODO: improve error rendering
	console.error(err);

	process.exitCode = err.exitCode || 1;
}
