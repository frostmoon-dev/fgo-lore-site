import { relay } from "../lib/relay.js";

// POST /api/chat -> {baseUrl}/chat/completions
export default { fetch: (request) => relay(request, "chat/completions") };
