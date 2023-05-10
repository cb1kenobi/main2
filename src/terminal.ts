interface TerminalOptions {
	stdout: NodeJS.WriteStream;
	stderr: NodeJS.WriteStream;
}

export class Terminal {
	stdout: NodeJS.WriteStream;
	stderr: NodeJS.WriteStream;

	constructor(opts: TerminalOptions) {
		this.stdout = this.initStream(opts.stdout || process.stdout);
		this.stderr = this.initStream(opts.stderr || process.stderr);
	}

	initStream(stream: NodeJS.WriteStream): NodeJS.WriteStream {
		stream.on('error', function epipeListener(err) {
			if (err.code === 'EPIPE') {
				process.exit(1);
			} else {
				stream.removeAllListeners();
				stream.emit('error', err);
				stream.on('error', epipeListener);
			}
		});

		return stream;
	}
}

/*

cursor
	.to(x, y)
	.move(x, y)
	.up(count = 1)
	.down(count = 1)
	.forward(count = 1)
	.backward(count = 1)
	.nextLine(count = 1)
	.prevLine(count = 1)
	.left
	.hide
	.show
	.save
	.restore
	.get
scroll
	.up(count = 1)
	.down(count = 1)
erase
	.screen
	.up(count = 1)
	.down(count = 1)
	.line
	.lineEnd
	.lineStart
	.lines(count)
clear
	.screen
beep
link(text, url)

widgets
	barChart
	canvas
	gauge
	image
	list
	markdown
	plot
	progress
	prompt
	sparkline
	spinner
	stackedBarChar
	table
	tabs
	tree

*/
