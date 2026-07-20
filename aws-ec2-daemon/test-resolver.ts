import 'dotenv/config';
import { resolveNiftyFuturesKey } from './src/instrument-resolver.js';
resolveNiftyFuturesKey().then(console.log).catch(console.error);
