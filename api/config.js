import { config } from "../lib/relay.js";

// GET /api/config -> whether this site offers its own key
export default { fetch: () => config() };
