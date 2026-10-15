import { tratar } from "./tratar.ts";

Deno.serve((req) => tratar(req, Deno.env));
