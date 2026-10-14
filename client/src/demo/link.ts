/**
 * tRPC-Link für den Chat-Build: statt HTTP-Requests an /api/trpc werden die
 * Prozeduren direkt im Browser ausgeführt (siehe backend.ts).
 */
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { callProcedure } from "./backend";

export function localDemoLink<TRouter extends AnyRouter>(): TRPCLink<TRouter> {
  return () => ({ op }) => observable((observer) => {
    let cancelled = false;
    // Kurze Verzögerung, damit Lade-Zustände sichtbar bleiben und React Query
    // seine Batch-Logik wie beim echten Backend anwendet.
    const timer = window.setTimeout(() => {
      callProcedure(op.path, op.input)
        .then((data) => {
          if (cancelled) return;
          observer.next({ result: { type: "data", data } });
          observer.complete();
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          const error = cause instanceof Error ? cause : new Error(String(cause));
          observer.error(TRPCClientError.from(error));
        });
    }, 30);
    return () => { cancelled = true; window.clearTimeout(timer); };
  });
}
