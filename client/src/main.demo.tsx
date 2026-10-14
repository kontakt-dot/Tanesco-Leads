import "./demo/bootstrap";
import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import VoicePopup from "@/components/VoicePopup";
import DemoApp from "./demo/App.demo";
import { localDemoLink } from "./demo/link";
import "./index.css";
import "./theme-light.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

queryClient.getQueryCache().subscribe((event) => {
  if (event.type === "updated" && event.action.type === "error") console.error("[Demo Query Error]", event.query.state.error);
});
queryClient.getMutationCache().subscribe((event) => {
  if (event.type === "updated" && event.action.type === "error") console.error("[Demo Mutation Error]", event.mutation.state.error);
});

const trpcClient = trpc.createClient({ links: [localDemoLink()] });

// Kleines Fenster zum Einsprechen (Notizen) – siehe lib/voice.ts
const voiceToken = (() => { try { return new URLSearchParams(window.location.search).get("voice"); } catch { return null; } })();

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      {voiceToken ? <VoicePopup token={voiceToken} /> : <DemoApp />}
    </QueryClientProvider>
  </trpc.Provider>,
);
