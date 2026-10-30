// Explicit deployment artifact for the online rollout only. Normal index.ts
// continues rejecting the shared token. SQL owns bridge expiry and revocation.
import { workerFor } from './index';
export default workerFor({ legacyIngest: true, rolloutReads: true });
