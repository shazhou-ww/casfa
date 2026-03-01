import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createCasFacade } from "./services/cas.ts";
import { createRealmFacadeFromConfig } from "./services/realm.ts";

const config = loadConfig();
const { cas, key } = createCasFacade(config);
const realm = createRealmFacadeFromConfig(cas, key, config);
const app = createApp({ config, cas, realm });
Bun.serve({ port: config.port, fetch: app.fetch });
