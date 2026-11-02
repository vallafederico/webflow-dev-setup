// Inside the lifecycle folder, siblings are imported relatively.
import { onDestroy } from "./runner";

export function track(fn: () => void) {
  onDestroy(fn);
}
