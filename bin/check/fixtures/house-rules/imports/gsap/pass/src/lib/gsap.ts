// The one file that may import the package directly.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default gsap;
export { ScrollTrigger };
