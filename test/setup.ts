// Renderer modules read the preload bridge at import time; give them a minimal one.
;(globalThis as unknown as { window: unknown }).window = { api: { platform: 'linux' } }
