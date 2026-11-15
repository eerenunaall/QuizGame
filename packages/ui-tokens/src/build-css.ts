import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fullCss } from './themes';

writeFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), fullCss());
