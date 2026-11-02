export const a = (process as any).env.NODE_ENV;
export const b = process["env"]["NODE_ENV"];
export const { NODE_ENV } = process.env;
export const hasProcess = typeof process !== "undefined";
