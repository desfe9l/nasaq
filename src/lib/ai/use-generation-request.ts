import { useEffect, useRef } from "react";
import { createGenerationRequestGuard } from "./generation-request";

export function useGenerationRequest(key: string) {
  const guard = useRef(createGenerationRequestGuard()).current;
  guard.update(key);
  useEffect(() => () => guard.invalidate(), [guard]);
  return guard;
}
