import { useWorldStore } from "../state/world-store";
import { CONNECTION_LABELS } from "../lib/command-center";

export function ConnectionStatus() {
  const status = useWorldStore(s => s.socketStatus);
  return <span role="status" className={`connection-status connection-${status}`}>
    <span aria-hidden>●</span> {CONNECTION_LABELS[status]}
  </span>;
}
