import { createFileRoute } from "@tanstack/react-router";
import { OpenNsqPage } from "@/components/site/OpenNsqPage";

/**
 * `/open` — the entry point for a received `.nsq` file: the installed app's
 * OS file handler (`file_handlers` in the web manifest), the link in every
 * package's README, and anyone who lands here with a file. Open to visitors:
 * the file is recognised and preserved BEFORE any account is requested.
 */
export const Route = createFileRoute("/open")({
  ssr: false,
  component: OpenNsqPage,
});
