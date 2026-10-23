// Preload for the bin test: pretend to be Node 20, so the version check's exit path runs.
Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '20.0.0' } });
