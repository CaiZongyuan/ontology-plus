import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

const edgeStore = createWorkspaceStore({
  dbPath: ':memory:',
  enableFileMirror: false,
});

const app = createApiApp(edgeStore);

export default {
  fetch: app.fetch,
};

