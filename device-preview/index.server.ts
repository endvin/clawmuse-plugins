import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  capabilitiesRpc,
  listRpc,
  startRpc,
  statusRpc,
  frameRpc,
  inputRpc,
  stopRpc,
} from "./shared/contracts.js";
import { createPreviewService } from "./server/service.js";

export default function contribute(server: PluginServerContext) {
  const service = createPreviewService();
  server.handle(capabilitiesRpc, () => service.capabilities());
  server.handle(listRpc, ({ platform }) => service.list(platform));
  server.handle(startRpc, (input) => service.start(input));
  server.handle(statusRpc, ({ operationId }) => service.status(operationId));
  server.handle(frameRpc, ({ operationId, afterSequence }) =>
    service.frame(operationId, afterSequence),
  );
  server.handle(inputRpc, ({ operationId, action }) => service.input(operationId, action));
  server.handle(stopRpc, ({ operationId }) => service.stop(operationId));
  return () => service.close();
}
