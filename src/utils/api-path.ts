import { PUBLIC_ASSET_ORIGIN } from "./public-asset";

declare const __API_DEV_ORIGIN__: string;

const basePath = "/api/";

/** Build-time define: `bin/api.ts` in dev, empty in production so no localhost URL ships. */
const origin = (__API_DEV_ORIGIN__ || PUBLIC_ASSET_ORIGIN).replace(/\/$/, "");

export const apiPath = (route: string = "") => `${origin}${basePath}${route}`;
