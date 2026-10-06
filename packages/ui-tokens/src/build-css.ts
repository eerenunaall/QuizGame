import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cssVariables } from './tokens';

writeFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), cssVariables());
