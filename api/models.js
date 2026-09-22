import { relay } from "../lib/relay.js";

// POST /api/models -> GET {baseUrl}/models
export default { fetch: (request) => relay(request, "models") };
