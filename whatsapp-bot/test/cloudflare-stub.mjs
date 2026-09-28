// Nos testes (Node), substitui o módulo "cloudflare:workers" do Cloudflare por uma versão mínima.
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
    }
    return next(specifier, context);
  }
`));
