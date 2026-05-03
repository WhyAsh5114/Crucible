import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// xterm.js ships with `module` pointing at an .mjs but no `exports` field, so
	// Vite's default resolver falls back to the CJS `main` and chokes on named
	// imports. Pre-bundling them with esbuild produces an ESM façade that
	// re-exports `Terminal` and `FitAddon` as named exports.
	optimizeDeps: {
		include: ['@xterm/xterm', '@xterm/addon-fit']
	},
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:3000',
				changeOrigin: true,
				// Vite uses http-proxy under the hood, which buffers responses
				// by default. SSE needs both headers AND each body chunk
				// flushed immediately so events render as the agent emits
				// them — not in a clump at turn end / on cancel.
				configure: (proxy) => {
					proxy.on('proxyRes', (proxyRes, _req, res) => {
						const ct = proxyRes.headers['content-type'];
						if (typeof ct !== 'string' || !ct.includes('text/event-stream')) return;

						// Flush response headers right away so the browser sees
						// the open EventSource without waiting for the first
						// agent event.
						setImmediate(() => {
							if (!res.headersSent && !res.writableEnded) {
								res.flushHeaders();
							}
						});

						// Defeat Nagle's algorithm on the downstream socket.
						// Without TCP_NODELAY, small SSE chunks (< ~1.5 KB
						// each, which is typical for one event) queue up
						// in the kernel and are only flushed when the buffer
						// fills, the connection closes, or another large
						// chunk lands. That's exactly the "events appear all
						// at once on cancel" symptom: cancel closes the
						// stream, which forces the kernel to flush.
						const sock = res.socket as import('net').Socket | undefined;
						sock?.setNoDelay(true);
					});
				}
			},
			'/ws': {
				target: 'ws://localhost:3000',
				ws: true,
				changeOrigin: true
			}
		}
	}
});
