export const deployUrl = process.env.VERCEL_URL;

export function read(name: string) {
  return process.env[name];
}
