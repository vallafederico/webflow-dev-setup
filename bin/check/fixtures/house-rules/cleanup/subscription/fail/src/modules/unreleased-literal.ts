import { onEditor } from "@/modules/_";
import { Resize } from "@lib/subs";

export default function () {
  onEditor(() => {});
  const all = [Resize.add(() => {}), Resize.add(() => {})];
  return all.length;
}
