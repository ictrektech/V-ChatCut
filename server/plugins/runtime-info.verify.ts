import assert from 'node:assert/strict';
import { runtimeAppVersion } from './runtime-info.ts';

assert.equal(runtimeAppVersion({ VOS_APP_VERSION: ' 0.0.17 ' }), '0.0.17');
assert.equal(runtimeAppVersion({}), null);

console.log('runtime-info.verify: VOS version comes from the container environment');
