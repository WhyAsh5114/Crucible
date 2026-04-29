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
				// by default. SSE needs the headers flushed immediately so the
				// browser EventSource sees the open connection.
				configure: (proxy) => {
					proxy.on('proxyRes', (proxyRes, _req, res) => {
						const ct = proxyRes.headers['content-type'];
						if (typeof ct === 'string' && ct.includes('text/event-stream')) {
							// Vite's proxy (http-proxy-3) only flushes response
							// headers once the upstream sends body bytes. SSE
							// streams may stay quiet for many seconds before the
							// first event, so flush headers ourselves on the next
							// tick (after Vite's writeHeaders pass) so the
							// browser's EventSource sees an open connection.
							setImmediate(() => {
								if (!res.headersSent && !res.writableEnded) {
									res.flushHeaders();
								}
							});
						}
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
