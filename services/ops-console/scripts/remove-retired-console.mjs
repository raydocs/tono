import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Only the retired, ignored Vite output. Shared code and public release assets stay.
rmSync(fileURLToPath(new URL('../../control-plane/public/ops2', import.meta.url)), { recursive: true, force: true });
